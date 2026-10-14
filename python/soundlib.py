"""
Soundboard library: built-in pads plus the user's own sounds.

User sounds are uploaded from the UI (any format macOS can decode), converted
once to 48 kHz mono float WAV and kept in the app's data folder with their
settings (name, colour, volume, loop, hotkey) in library.json:
  ~/Library/Application Support/Aurora Voice/sounds   (AURORA_DATA overrides)
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import uuid
import struct

import numpy as np

SR = 48000
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_SECONDS = 120.0
PALETTE = ['#ffb764', '#b855e7', '#0088ff', '#16c253', '#e6714f', '#dd55e7', '#60a5fa', '#ffdd00']

# Built-in pads: clips from myinstants.com, stored in python/sounds/<file>.mp3.
SOUNDS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sounds')
BUILTIN = [
    {'id': 'b0', 'name': 'Heyy Daddy', 'color': '#ff6fb5', 'file': 'heyy-daddy'},
    {'id': 'b1', 'name': 'UwU', 'color': '#ff8fd0', 'file': 'girl-uwu'},
    {'id': 'b2', 'name': 'UwU Discord Girl', 'color': '#dd55e7', 'file': 'uwu-discord'},
    {'id': 'b3', 'name': 'Discord Ping', 'color': '#5865f2', 'file': 'discord-ping'},
    {'id': 'b4', 'name': 'Discord Join', 'color': '#5865f2', 'file': 'discord-join'},
    {'id': 'b5', 'name': 'Discord Leave', 'color': '#5865f2', 'file': 'discord-leave'},
    {'id': 'b6', 'name': 'Discord Call', 'color': '#5865f2', 'file': 'discord-call'},
    {'id': 'b7', 'name': 'Cat Scream', 'color': '#e6714f', 'file': 'discord-cat-scream'},
    {'id': 'b8', 'name': 'Vine Boom', 'color': '#ffb764', 'file': 'vine-boom'},
    {'id': 'b9', 'name': 'Bruh', 'color': '#888b91', 'file': 'bruh'},
    {'id': 'b10', 'name': 'Emotional Damage', 'color': '#e6714f', 'file': 'emotional-damage'},
    {'id': 'b11', 'name': 'FBI Open Up', 'color': '#0088ff', 'file': 'fbi-open-up'},
    {'id': 'b12', 'name': 'MLG Air Horn', 'color': '#ffdd00', 'file': 'airhorn'},
    {'id': 'b13', 'name': 'Sad Violin', 'color': '#4b52aa', 'file': 'sad-violin'},
    {'id': 'b14', 'name': 'Anime Wow', 'color': '#b855e7', 'file': 'anime-wow'},
    {'id': 'b15', 'name': 'Rizz', 'color': '#16c253', 'file': 'rizz'},
    {'id': 'b16', 'name': 'Among Us', 'color': '#e6714f', 'file': 'among-us'},
    {'id': 'b17', 'name': 'Taco Bell Bong', 'color': '#b855e7', 'file': 'taco-bell'},
    {'id': 'b18', 'name': 'Windows XP Off', 'color': '#60a5fa', 'file': 'windows-xp'},
    {'id': 'b19', 'name': 'Goku Drip', 'color': '#ffb764', 'file': 'goku-drip'},
    {'id': 'b20', 'name': 'Anime Ahh', 'color': '#ff6fb5', 'file': 'anime-ahh'},
    {'id': 'b21', 'name': 'Fahhh', 'color': '#e6714f', 'file': 'fahhh'},
    {'id': 'b22', 'name': 'Gop Gop Gop', 'color': '#16c253', 'file': 'gopgopgop'},
]


def resolve_id(sound_id) -> str:
    """Accept library ids ('u…', 'b3') and bare built-in indices (3)."""
    sid = str(sound_id)
    return f'b{sid}' if sid.isdigit() else sid


def data_dir() -> str:
    base = os.environ.get('AURORA_DATA') or os.path.expanduser('~/Library/Application Support/Aurora Voice')
    path = os.path.join(base, 'sounds')
    os.makedirs(path, exist_ok=True)
    return path


class SoundLibrary:
    def __init__(self, directory: str | None = None):
        self.dir = directory or data_dir()
        self.index_path = os.path.join(self.dir, 'library.json')
        self._lock = threading.Lock()
        self._cache: dict[str, np.ndarray] = {}
        self.sounds: list[dict] = self._load()

    # ── persistence ───────────────────────────────────────────────────────────
    def _load(self) -> list[dict]:
        builtin_settings = {}
        user = []
        try:
            with open(self.index_path) as f:
                saved = json.load(f)
            builtin_settings = {s['id']: s for s in saved if s.get('builtin')}
            user = [s for s in saved if not s.get('builtin') and os.path.isfile(self._wav(s['id']))]
        except (OSError, ValueError, KeyError):
            pass
        out = []
        for b in BUILTIN:
            s = {'volume': 1.0, 'loop': False, 'hotkey': None, **b, 'builtin': True}
            s['duration'] = round(self._builtin_seconds(b['file']), 2)
            s.update({k: v for k, v in builtin_settings.get(b['id'], {}).items() if k in ('volume', 'hotkey', 'loop')})
            out.append(s)
        return out + user

    def _save(self):
        tmp = self.index_path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self.sounds, f, indent=1)
        os.replace(tmp, self.index_path)

    def _wav(self, sid: str) -> str:
        return os.path.join(self.dir, f'{sid}.wav')

    # ── queries ───────────────────────────────────────────────────────────────
    def list(self) -> list[dict]:
        return [dict(s) for s in self.sounds]

    def get(self, sid: str) -> dict | None:
        return next((s for s in self.sounds if s['id'] == sid), None)

    # ── edits ─────────────────────────────────────────────────────────────────
    def add(self, name: str, filename: str, data_b64: str) -> dict:
        return self.add_bytes(name, filename, base64.b64decode(data_b64, validate=False))

    def add_bytes(self, name: str, filename: str, raw: bytes) -> dict:
        if not raw:
            raise ValueError('empty file')
        if len(raw) > MAX_UPLOAD_BYTES:
            raise ValueError(f'file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB')
        ext = os.path.splitext(filename or '')[1].lower()
        if not re.fullmatch(r'\.[a-z0-9]{1,5}', ext or '.x'):
            ext = ''
        sid = 'u' + uuid.uuid4().hex[:10]
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'in' + ext)
            with open(src, 'wb') as f:
                f.write(raw)
            dst = self._wav(sid)
            proc = subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEF32@{SR}', '-c', '1', src, dst],
                                  capture_output=True, text=True, timeout=60)
            if proc.returncode != 0 or not os.path.isfile(dst):
                raise ValueError('could not decode this audio file (try MP3, WAV, M4A, AAC, AIFF, FLAC or CAF)')
        audio = self._read(sid)
        if len(audio) == 0:
            os.remove(dst)
            raise ValueError('the file has no audio')
        if len(audio) > MAX_SECONDS * SR:
            audio = audio[: int(MAX_SECONDS * SR)]
            self._write(sid, audio)
        # Gentle normalisation so quiet clips are audible and loud ones don't clip.
        peak = float(np.max(np.abs(audio))) or 1.0
        if peak > 0.98 or peak < 0.25:
            audio = (audio * (0.9 / peak)).astype(np.float32)
            self._write(sid, audio)
        clean = re.sub(r'\s+', ' ', (name or os.path.splitext(filename or 'Sound')[0])).strip()[:40] or 'Sound'
        sound = {
            'id': sid, 'name': clean, 'color': PALETTE[len(self.sounds) % len(PALETTE)],
            'volume': 1.0, 'loop': False, 'hotkey': None, 'builtin': False,
            'duration': round(len(audio) / SR, 2), 'added': int(time.time()),
        }
        with self._lock:
            self.sounds.append(sound)
            self._cache[sid] = audio
            self._save()
        return dict(sound)

    def update(self, sid: str, changes: dict) -> dict:
        with self._lock:
            s = self.get(sid)
            if s is None:
                raise KeyError(sid)
            if 'name' in changes and not s.get('builtin'):
                s['name'] = str(changes['name']).strip()[:40] or s['name']
            if 'color' in changes and not s.get('builtin') and re.fullmatch(r'#[0-9a-fA-F]{6}', str(changes['color'])):
                s['color'] = changes['color']
            if 'volume' in changes:
                s['volume'] = min(2.0, max(0.0, float(changes['volume'])))
            if 'loop' in changes:
                s['loop'] = bool(changes['loop'])
            if 'hotkey' in changes:
                hk = changes['hotkey']
                hk = str(hk)[:40] if hk else None
                if hk:  # one sound per hotkey
                    for other in self.sounds:
                        if other is not s and other.get('hotkey') == hk:
                            other['hotkey'] = None
                s['hotkey'] = hk
            self._save()
            return dict(s)

    def delete(self, sid: str) -> bool:
        with self._lock:
            s = self.get(sid)
            if s is None or s.get('builtin'):
                return False
            self.sounds.remove(s)
            self._cache.pop(sid, None)
            try:
                os.remove(self._wav(sid))
            except OSError:
                pass
            self._save()
            return True

    # ── audio ─────────────────────────────────────────────────────────────────
    def audio(self, sid: str) -> np.ndarray | None:
        """Mono float32 at 48 kHz, scaled by the sound's own volume."""
        s = self.get(sid)
        if s is None:
            return None
        if s.get('builtin'):
            data = self._cache.get(sid)
            if data is None:
                data = self._decode_builtin(s['file'])
                self._cache[sid] = data
        else:
            data = self._cache.get(sid)
            if data is None:
                data = self._read(sid)
                self._cache[sid] = data
        return (data * float(s.get('volume', 1.0))).astype(np.float32)

    def _decode_builtin(self, name: str) -> np.ndarray:
        """A built-in clip as 48 kHz mono float, decoded once by afconvert."""
        with tempfile.TemporaryDirectory() as tmp:
            dst = os.path.join(tmp, 'b.wav')
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEF32@{SR}', '-c', '1',
                            os.path.join(SOUNDS_DIR, name + '.mp3'), dst], check=True, capture_output=True, timeout=30)
            x = read_wav(dst)
        peak = float(np.max(np.abs(x))) or 1.0
        return (x * min(1.0, 0.9 / peak) if peak > 0.9 else x).astype(np.float32)

    @staticmethod
    def _builtin_seconds(name: str) -> float:
        try:
            out = subprocess.run(['afinfo', os.path.join(SOUNDS_DIR, name + '.mp3')], capture_output=True, text=True, timeout=10).stdout
            return float(re.search(r'estimated duration: ([0-9.]+)', out).group(1))
        except (OSError, AttributeError, ValueError, subprocess.SubprocessError):
            return 2.0

    def _read(self, sid: str) -> np.ndarray:
        return read_wav(self._wav(sid))

    def _write(self, sid: str, audio: np.ndarray):
        write_wav(self._wav(sid), audio)


def read_wav(path: str) -> np.ndarray:
    """Mono float32 samples from a WAV file (float32, or 16/24/32-bit PCM)."""
    with open(path, 'rb') as f:
        data = f.read()
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('not a WAV file')
    pos, fmt, channels, bits = 12, None, 1, 32
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack('<I', data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b'fmt ':
            fmt, channels = struct.unpack('<HH', body[:4])
            bits = struct.unpack('<H', body[14:16])[0]
            if fmt == 0xFFFE and len(body) >= 26:  # WAVE_FORMAT_EXTENSIBLE: real format in the sub-GUID
                fmt = struct.unpack('<H', body[24:26])[0]
        elif cid == b'data':
            if fmt == 3 and bits == 32:
                x = np.frombuffer(body[: len(body) // 4 * 4], dtype='<f4')
            elif fmt == 1 and bits == 16:
                x = np.frombuffer(body[: len(body) // 2 * 2], dtype='<i2') / 32768.0
            elif fmt == 1 and bits == 32:
                x = np.frombuffer(body[: len(body) // 4 * 4], dtype='<i4') / 2147483648.0
            elif fmt == 1 and bits == 24:
                b = np.frombuffer(body[: len(body) // 3 * 3], dtype=np.uint8).reshape(-1, 3)
                x = ((b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16)) << 8 >> 8) / 8388608.0
            else:
                raise ValueError(f'unsupported WAV format {fmt}/{bits}')
            if channels > 1:
                x = x[: len(x) // channels * channels].reshape(-1, channels).mean(axis=1)
            return np.nan_to_num(np.asarray(x, dtype=np.float32)).copy()
        pos += 8 + size + (size & 1)
    raise ValueError('WAV file has no data')


def write_wav(path: str, audio: np.ndarray, sr: int = SR):
    """Mono float32 WAV."""
    pcm = np.asarray(audio, dtype='<f4').tobytes()
    header = (b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVE'
              + b'fmt ' + struct.pack('<IHHIIHH', 16, 3, 1, sr, sr * 4, 4, 32)
              + b'data' + struct.pack('<I', len(pcm)))
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(header + pcm)
    os.replace(tmp, path)
