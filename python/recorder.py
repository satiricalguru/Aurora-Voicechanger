"""
Recorder and instant replay, on top of the native engine's capture API.

Two sources:
  voice  what the call hears (changed voice + soundboard)
  mac    Mac audio: every other app (YouTube, games...) through a Core Audio
         process tap. macOS asks for System Audio Recording permission once.

The engine keeps the last ~85 s of each source in memory. Instant replay
writes the last N seconds to a file on demand; the recorder streams to a file
until stopped. Files are 16-bit mono WAV in
  ~/Library/Application Support/Aurora Voice/recordings   (AURORA_DATA overrides)
with names, sources and waveform peaks in index.json.
"""
from __future__ import annotations

import base64
import json
import os
import re
import struct
import threading
import time
import uuid

import numpy as np

from soundlib import read_wav

SOURCES = ('voice', 'mac')
REPLAY_LENGTHS = (10, 30, 60)
MAC_DENIED = ('Aurora Voice isn’t allowed to record Mac audio. Turn it on in System Settings › '
              'Privacy & Security › Screen & System Audio Recording.')
PEAKS = 96
MAX_CLIP_SECONDS = 120.0  # soundboard limit


def data_dir() -> str:
    base = os.environ.get('AURORA_DATA') or os.path.expanduser('~/Library/Application Support/Aurora Voice')
    path = os.path.join(base, 'recordings')
    os.makedirs(path, exist_ok=True)
    return path


def _wav_rate(path: str) -> int:
    with open(path, 'rb') as f:
        head = f.read(28)
    return struct.unpack('<I', head[24:28])[0] if len(head) >= 28 else 48000


def _peaks(x: np.ndarray, n: int = PEAKS) -> list[float]:
    if len(x) == 0:
        return [0.0] * n
    edges = np.linspace(0, len(x), n + 1).astype(int)
    p = [float(np.max(np.abs(x[a:b]))) if b > a else 0.0 for a, b in zip(edges[:-1], edges[1:])]
    top = max(p) or 1.0
    return [round(v / top, 3) for v in p]


def _wav16(x: np.ndarray, sr: int) -> bytes:
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    return (b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVE'
            + b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sr, sr * 2, 2, 16)
            + b'data' + struct.pack('<I', len(pcm)) + pcm)


class Recorder:
    def __init__(self, engine, library, directory: str | None = None):
        self.engine = engine
        self.library = library          # SoundLibrary, for "add to soundboard"
        self.dir = directory or data_dir()
        self.index_path = os.path.join(self.dir, 'index.json')
        self.settings_path = os.path.join(self.dir, 'settings.json')
        self._lock = threading.RLock()
        self.items: list[dict] = self._load()
        self.settings = {'replay_enabled': True, 'replay_source': 'voice', 'replay_seconds': 30, 'record_source': 'voice'}
        try:
            with open(self.settings_path) as f:
                saved = json.load(f)
            self.settings.update({k: saved[k] for k in self.settings if k in saved})
        except (OSError, ValueError):
            pass
        self.current: dict | None = None  # recording in progress
        self.error: str | None = None
        self._mac_since = 0.0
        self._mac_heard = False
        self._tap_wait = False   # macOS permission prompt is open; retry when answered
        self._peak = {'voice': 0.0, 'mac': 0.0}
        self.supported = all(hasattr(engine, m) for m in ('record_start', 'record_stop', 'replay_save', 'capture_system'))
        if self.supported:
            # Off the startup path: opening the tap can wait on the permission prompt.
            threading.Thread(target=self._sync_tap_locked, daemon=True).start()

    def _sync_tap_locked(self):
        with self._lock:
            self._sync_tap()

    # ── persistence ───────────────────────────────────────────────────────────
    def _load(self) -> list[dict]:
        try:
            with open(self.index_path) as f:
                items = json.load(f)
            return [r for r in items if os.path.isfile(self._path(r['id']))]
        except (OSError, ValueError, KeyError):
            return []

    def _save(self):
        tmp = self.index_path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self.items, f, indent=1)
        os.replace(tmp, self.index_path)

    def _save_settings(self):
        with open(self.settings_path, 'w') as f:
            json.dump(self.settings, f, indent=1)

    def _path(self, rid: str) -> str:
        return os.path.join(self.dir, f'{rid}.wav')

    def get(self, rid: str) -> dict | None:
        return next((r for r in self.items if r['id'] == rid), None)

    def list(self) -> list[dict]:
        return [{**r, 'path': self._path(r['id'])} for r in sorted(self.items, key=lambda r: -r['created'])]

    # ── Mac audio tap: open while replay or a recording needs it ──────────────
    def _tap_needed(self) -> bool:
        s = self.settings
        return ((s['replay_enabled'] and s['replay_source'] == 'mac')
                or bool(self.current and self.current['source'] == 'mac'))

    def _sync_tap(self):
        want = self._tap_needed()
        on = self.engine.capture_status().get('system', False)
        try:
            if want and not on:
                self.engine.capture_system(True)
                self._mac_since, self._mac_heard = time.monotonic(), False
                self._tap_wait = False
                self.error = None
            elif not want and on:
                self.engine.capture_system(False)
            if not want:
                self._tap_wait = False
        except RuntimeError as e:
            msg = str(e)
            self._tap_wait = 'waiting for permission' in msg
            self.error = None if self._tap_wait else (
                MAC_DENIED if 'denied' in msg else f'Mac audio: {msg}')


    # ── recording ─────────────────────────────────────────────────────────────
    def start(self, source: str | None = None) -> dict:
        """Start recording `source` (default: the last one used, for the F6 hotkey)."""
        with self._lock:
            source = source or self.settings['record_source']
            if not self.supported:
                raise RuntimeError('the recorder needs the native engine')
            if self.current:
                raise RuntimeError('already recording')
            if source not in SOURCES:
                raise ValueError(f'unknown source {source!r}')
            self.current = {'id': 'r' + uuid.uuid4().hex[:10], 'source': source, 'started': time.time()}
            self._sync_tap()
            if source == 'mac' and not self.engine.capture_status().get('system'):
                self.current = None
                waiting = self._tap_wait
                self._sync_tap()
                raise RuntimeError('Allow Aurora Voice to record your Mac’s audio in the macOS dialog, then press record again.'
                                   if waiting else (self.error or 'Mac audio capture is off'))
            try:
                self.engine.record_start(SOURCES.index(source), self._path(self.current['id']))
            except RuntimeError:
                self.current = None
                self._sync_tap()
                raise
            self.error = None
            if self.settings['record_source'] != source:
                self.settings['record_source'] = source
                self._save_settings()
            return dict(self.current)

    def stop(self) -> dict | None:
        """Stop and keep the recording. Returns it (None if nothing was recording)."""
        with self._lock:
            cur, self.current = self.current, None
            if cur is None:
                return None
            self.engine.record_stop()
            self._sync_tap()
            n = sum(1 for r in self.items if r['kind'] == 'recording') + 1
            label = 'Mac audio' if cur['source'] == 'mac' else 'Recording'
            return self._register(cur['id'], f'{label} {n}', cur['source'], 'recording', cur['started'])

    def save_replay(self, seconds: float | None = None) -> dict:
        with self._lock:
            if not self.supported:
                raise RuntimeError('instant replay needs the native engine')
            source = self.settings['replay_source']
            secs = float(seconds or self.settings['replay_seconds'])
            if source == 'mac' and not self.engine.capture_status().get('system'):
                self._sync_tap()
                raise RuntimeError(self.error or 'Mac audio capture is off')
            rid = 'r' + uuid.uuid4().hex[:10]
            got = self.engine.replay_save(SOURCES.index(source), secs, self._path(rid))
            n = sum(1 for r in self.items if r['kind'] == 'replay') + 1
            return self._register(rid, f'Replay {n}', source, 'replay', time.time() - got)

    def _register(self, rid: str, name: str, source: str, kind: str, started: float) -> dict:
        path = self._path(rid)
        try:
            x = read_wav(path)
        except (OSError, ValueError):
            x = np.zeros(0, np.float32)
        sr = _wav_rate(path) if os.path.isfile(path) else 48000
        if len(x) < 0.05 * sr:
            try:
                os.remove(path)
            except OSError:
                pass
            raise RuntimeError('the recording was empty')
        item = {'id': rid, 'name': name, 'source': source, 'kind': kind, 'created': int(started),
                'duration': round(len(x) / sr, 2), 'rate': sr, 'peaks': _peaks(x),
                'silent': bool(np.max(np.abs(x)) < 1e-4)}
        self.items.append(item)
        self._save()
        return {**item, 'path': path}

    # ── edits ─────────────────────────────────────────────────────────────────
    def rename(self, rid: str, name: str):
        with self._lock:
            r = self.get(rid)
            if r is None:
                raise KeyError(rid)
            r['name'] = re.sub(r'\s+', ' ', str(name)).strip()[:60] or r['name']
            self._save()

    def delete(self, rid: str):
        with self._lock:
            r = self.get(rid)
            if r is None:
                return
            self.items.remove(r)
            try:
                os.remove(self._path(rid))
            except OSError:
                pass
            self._save()

    def audio_b64(self, rid: str) -> str:
        if self.get(rid) is None:
            raise KeyError(rid)
        with open(self._path(rid), 'rb') as f:
            return base64.b64encode(f.read()).decode()

    def to_sound(self, rid: str, start: float = 0.0, end: float | None = None, name: str | None = None) -> dict:
        """Trimmed copy of a recording as a new soundboard pad."""
        r = self.get(rid)
        if r is None:
            raise KeyError(rid)
        x = read_wav(self._path(rid))
        sr = int(r.get('rate', 48000))
        a = max(0, int(float(start) * sr))
        b = len(x) if end is None else min(len(x), int(float(end) * sr))
        if b - a < 0.05 * sr:
            raise ValueError('select at least 0.05 s')
        if b - a > MAX_CLIP_SECONDS * sr:
            raise ValueError(f'soundboard sounds can be up to {int(MAX_CLIP_SECONDS)} s; trim it first')
        return self.library.add_bytes(name or r['name'], 'clip.wav', _wav16(x[a:b], sr))

    # ── settings and status ───────────────────────────────────────────────────
    def configure(self, changes: dict):
        with self._lock:
            if 'replay_enabled' in changes:
                self.settings['replay_enabled'] = bool(changes['replay_enabled'])
            for key in ('replay_source', 'record_source'):
                if changes.get(key) in SOURCES:
                    self.settings[key] = changes[key]
            if 'replay_seconds' in changes:
                self.settings['replay_seconds'] = min(REPLAY_LENGTHS, key=lambda v: abs(v - float(changes['replay_seconds'])))
            self._save_settings()
            if self.supported:
                self._sync_tap()

    def poll(self) -> dict | None:
        """Called ~30x a second. Collects a recording that ended by itself
        (30 min limit, device change) and returns it."""
        if not self.supported:
            return None
        st = self.engine.capture_status()
        self._peak = {'voice': st.get('voice_peak', 0.0), 'mac': st.get('system_peak', 0.0)}
        if self._peak['mac'] > 3e-4:
            self._mac_heard = True
        # Permission prompt answered: open the tap (off this thread), or explain.
        if self._tap_wait and st.get('system_permission') in (0, 1):
            self._tap_wait = False
            threading.Thread(target=self._sync_tap_locked, daemon=True).start()
        if self.current and not st.get('recording') and st.get('record_pending'):
            try:
                return self.stop()
            except RuntimeError as e:
                self.error = str(e)
        return None

    def status(self) -> dict:
        st = self.engine.capture_status() if self.supported else {}
        src = self.settings['replay_source']
        have = st.get('system_seconds' if src == 'mac' else 'voice_seconds', 0.0)
        mac_on = bool(st.get('system'))
        return {
            'supported': self.supported,
            'recording': bool(self.current),
            'source': self.current['source'] if self.current else None,
            'seconds': round(st.get('record_seconds', 0.0), 1) if self.current else 0,
            'replay': {**self.settings, 'buffered': round(min(have, self.settings['replay_seconds']), 1)},
            'mac_capture': mac_on,
            'mac_pending': self._tap_wait or bool(st.get('system_starting')),  # macOS permission prompt open
            'mac_permission': st.get('system_permission', -1),  # -1 unknown, 0 granted, 1 denied, 2 not asked
            # Tap open for a while and never a sample: most likely no permission.
            'mac_silent': mac_on and not self._mac_heard and time.monotonic() - self._mac_since > 4,
            'level': self._peak,
            'error': self.error,
        }
