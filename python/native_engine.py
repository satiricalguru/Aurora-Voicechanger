"""
Native audio engine backend (Aurora Core, C++/CoreAudio) behind the same
interface as engine.AudioEngine, so ws_server can use either.

The real-time path runs entirely in native/aurora-core; Python only sends
voice configs and settings and reads stats. Device indices refer to
get_devices() of this backend (CoreAudio order), not sounddevice's.
"""
from __future__ import annotations

import ctypes
import json
import os
import subprocess
import tempfile
import threading
import time
import wave

import numpy as np

from voices.presets import VOICE_PRESETS
from voices.ai_personas import AI_PERSONAS
from voices.neural import NEURAL_VOICES

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
_LIB_CANDIDATES = (
    os.environ.get('AURORA_CORE_LIB', ''),
    os.path.join(os.path.dirname(__file__), 'libaurora_core.dylib'),            # packaged
    os.path.join(_ROOT, 'native', 'aurora-core', 'build', 'libaurora_core.dylib'),  # dev
)

def models_dir() -> str:
    for p in (os.environ.get('AURORA_MODELS', ''),
              os.path.join(os.path.dirname(__file__), '..', 'models'),       # dev + packaged Resources/
              os.path.join(_ROOT, 'models')):
        if p and os.path.isdir(p):
            return os.path.abspath(p)
    return os.path.join(_ROOT, 'models')


# Background-noise removal (RNNoise): UI name -> engine nr_mode.
NR_MODES = {'low_latency': 1, 'balanced': 2, 'quality': 3}

PERSONA_KEYS = ('target_f0_mean', 'resonance_shift', 'breathiness', 'roughness',
                'brightness', 'vibrato_rate', 'vibrato_depth')


def _prefer_official_onnxruntime():
    """Point Aurora Core at Microsoft's ONNX Runtime build from the pip package
    when present: on Apple Silicon it runs the voice model ~1.5x faster than
    Homebrew's build. Located without importing it."""
    if os.environ.get('AURORA_ORT_LIB'):
        return
    import glob
    import importlib.util
    spec = importlib.util.find_spec('onnxruntime')
    if spec and spec.origin:
        libs = sorted(glob.glob(os.path.join(os.path.dirname(spec.origin), 'capi', 'libonnxruntime*.dylib')))
        if libs:
            os.environ['AURORA_ORT_LIB'] = libs[-1]


def find_library() -> str | None:
    for p in _LIB_CANDIDATES:
        if p and os.path.isfile(p):
            return p
    return None


def persona_config(persona: dict) -> dict:
    return {'persona': {k: persona[k] for k in PERSONA_KEYS if k in persona},
            'chain': persona.get('pitch_chain', [])}


class NativeAudioEngine:
    SR = 48000
    BUFFER = int(os.environ.get("AURORA_BUFFER", "64"))  # HAL I/O frames; engine clamps per device

    def __init__(self, lib_path: str | None = None):
        _prefer_official_onnxruntime()
        path = lib_path or find_library()
        if not path:
            raise OSError('libaurora_core.dylib not found (build native/aurora-core)')
        self._lib = ctypes.CDLL(path)
        self._bind()
        self.lib_path = path
        self.bypass_value = False
        self.vol_mic = self.vol_voice = self.vol_sound = self.vol_monitor = 1.0
        self.noise_reduction_enabled = False
        self.noise_reduction_mode = 'balanced'
        self.noise_reduction_strength = 0.85
        self.noise_gate_enabled = True
        self.noise_gate_level = -44.0
        self.muted = False
        self.sounds_to_headphones = True  # pads also play on the default output when not monitoring
        self.library = None               # SoundLibrary, attached by ws_server
        self._sound_gen = 0
        self.active_voice_id: str | None = None
        self.last_error: str | None = None
        self._devices: list[dict] = []
        self._input_idx: int | None = None
        self._output_idx: int | None = None
        self.monitor_device: int | None = None
        self._measured_ms: float | None = None
        self._stats: dict = {}
        self._stats_at = 0.0
        self._lock = threading.Lock()
        print(f"[native] Aurora Core {self._lib.ac_version().decode()} from {path}")

    # ── ctypes plumbing ───────────────────────────────────────────────────────

    def _bind(self):
        L = self._lib
        c_char_p, c_int, c_double = ctypes.c_char_p, ctypes.c_int, ctypes.c_double
        L.ac_version.restype = c_char_p
        L.ac_last_error.restype = c_char_p
        for name in ('ac_list_devices', 'ac_get_stats', 'ac_measure_loopback'):
            getattr(L, name).argtypes = [ctypes.c_char_p, c_int]
            getattr(L, name).restype = c_int
        L.ac_start.argtypes = [c_char_p, c_char_p, c_int, c_double]
        L.ac_start_monitor.argtypes = [c_char_p]
        L.ac_set_chain.argtypes = [c_char_p]
        L.ac_set_param.argtypes = [c_char_p, c_char_p, c_double]
        L.ac_set_setting.argtypes = [c_char_p, c_double]
        L.ac_queue_sound.argtypes = [ctypes.POINTER(ctypes.c_float), c_int, c_double]
        L.ac_play_sound.argtypes = [ctypes.POINTER(ctypes.c_float), c_int, c_double]
        L.ac_render_offline.argtypes = [c_char_p, ctypes.POINTER(ctypes.c_float),
                                        ctypes.POINTER(ctypes.c_float), c_int, c_double, c_int]

    def _json_call(self, fn, cap: int = 16384):
        buf = ctypes.create_string_buffer(cap)
        need = fn(buf, cap)
        if need > cap:
            buf = ctypes.create_string_buffer(need)
            fn(buf, need)
        return json.loads(buf.value.decode('utf-8') or 'null')

    def _err(self) -> str:
        return self._lib.ac_last_error().decode('utf-8', 'replace')

    def _check(self, rc: int, what: str) -> bool:
        if rc != 0:
            self.last_error = f'{what}: {self._err()}'
            print(f"[native] {self.last_error}")
            return False
        return True

    # ── Voices ────────────────────────────────────────────────────────────────

    def set_voice(self, preset_id: str):
        if preset_id in VOICE_PRESETS:
            cfg = {'chain': VOICE_PRESETS[preset_id]['chain']}
        elif preset_id in AI_PERSONAS:
            cfg = persona_config(AI_PERSONAS[preset_id])
        elif preset_id in NEURAL_VOICES:
            cfg = self.neural_config(NEURAL_VOICES[preset_id])
        else:
            self.last_error = f'Unknown voice: {preset_id}'
            return
        if self._check(self._lib.ac_set_chain(json.dumps(cfg).encode()), 'set_voice'):
            self.active_voice_id = preset_id
            self.last_error = None

    @staticmethod
    def neural_config(voice: dict) -> dict:
        model = os.path.join(models_dir(), voice['model'])
        return {'chain': [{'effect': 'neural_vc', 'model': model}, *voice.get('post_chain', [])]}

    def neural_voices(self) -> dict:
        """Neural voices whose model loads here (checked once per model file)."""
        if not hasattr(self, '_neural_ok'):
            self._neural_ok = {}
        out = {}
        for vid, v in NEURAL_VOICES.items():
            path = os.path.join(models_dir(), v['model'])
            if path not in self._neural_ok:
                ok = False
                if os.path.isfile(path):
                    _, lat = self.render_offline({'chain': [{'effect': 'neural_vc', 'model': path}]},
                                                 np.zeros(4800, np.float32))
                    ok = lat >= 0
                    if not ok:
                        print(f"[native] Neural model unavailable: {self._err()}")
                self._neural_ok[path] = ok
            if self._neural_ok[path]:
                out[vid] = v
        return out

    def set_custom_chain(self, stages: list[dict]):
        if self._check(self._lib.ac_set_chain(json.dumps({'chain': stages}).encode()), 'custom chain'):
            self.active_voice_id = 'custom'

    def set_param(self, effect: str, param: str, value):
        try:
            v = float(value)
        except (TypeError, ValueError):
            return
        self._check(self._lib.ac_set_param(effect.encode(), param.encode(), v), 'set_param')

    @property
    def bypass(self) -> bool:
        return self.bypass_value

    @bypass.setter
    def bypass(self, v: bool):
        self.bypass_value = bool(v)
        self._lib.ac_set_setting(b'bypass', 1.0 if v else 0.0)

    # ── Devices and streams ───────────────────────────────────────────────────

    def get_devices(self) -> list[dict]:
        devs = self._json_call(self._lib.ac_list_devices) or []
        for d in devs:
            name = d['name'].lower()
            d['is_blackhole'] = 'blackhole' in name
            d['is_aurora'] = d['uid'] == 'AuroraMicrophone_UID'
            d['is_virtual_mic'] = d['is_blackhole'] or d['is_aurora']
        self._devices = devs
        return devs

    def _uid(self, idx: int | None) -> str | None:
        if idx is None:
            return None
        devs = self._devices or self.get_devices()
        for d in devs:
            if d['index'] == idx:
                return d['uid']
        return None

    def find_virtual_mic(self) -> int | None:
        """Output that feeds the virtual mic: Aurora Microphone, else BlackHole."""
        devs = [d for d in self.get_devices() if d['outputs'] > 0]
        for key in ('is_aurora', 'is_blackhole'):
            for d in devs:
                if d[key]:
                    return d['index']
        return None

    def find_default_output(self) -> int | None:
        devs = self.get_devices()
        for d in devs:
            if d['outputs'] > 0 and not d['is_virtual'] and d['is_default_output']:
                return d['index']
        for d in devs:
            if d['outputs'] > 0 and not d['is_virtual'] and not d['is_virtual_mic']:
                return d['index']
        return None

    def start(self, input_idx: int, output_idx: int):
        self.get_devices()
        in_uid, out_uid = self._uid(int(input_idx)), self._uid(int(output_idx))
        if not in_uid or not out_uid:
            self.last_error = 'Unknown device index'
            return
        self._input_idx, self._output_idx = int(input_idx), int(output_idx)
        self._push_settings()
        rc = self._lib.ac_start(in_uid.encode(), out_uid.encode(), self.BUFFER, float(self.SR))
        if self._check(rc, 'Stream error'):
            self.last_error = None
            self._measured_ms = None
            self.monitor_device = None
            print(f"[native] Stream started: {in_uid} -> {out_uid}")
            self._open_preview()

    def stop(self):
        self._lib.ac_stop()
        self.monitor_device = None
        print("[native] Stream stopped")

    def is_running(self) -> bool:
        return bool(self._lib.ac_is_running())

    def start_monitor(self, device_idx: int):
        """Hear myself: voice + sounds on `device_idx`."""
        uid = self._uid(int(device_idx))
        if uid and self._check(self._lib.ac_start_monitor(uid.encode()), 'Monitor'):
            self._lib.ac_set_setting(b'monitor_voice', 1.0)
            self.monitor_device = int(device_idx)

    def stop_monitor(self):
        self._lib.ac_stop_monitor()
        self.monitor_device = None
        self._open_preview()

    def is_monitoring(self) -> bool:
        """True only for 'hear myself' (not the sounds-only preview)."""
        return self.monitor_device is not None and bool(self._lib.ac_is_monitoring())

    def _open_preview(self):
        """Without 'hear myself', keep the default speakers/headphones open for
        soundboard pads only, so you hear what you play into the call. Runs in
        the native engine (drift-corrected, any device rate)."""
        if not self.sounds_to_headphones or not self.is_running():
            return
        out_uid = self._uid(self._output_idx)
        devs = self._devices or self.get_devices()
        target = next((d for d in devs if d['outputs'] > 0 and d['is_default_output'] and not d['is_virtual_mic']
                       and not d['is_virtual'] and d['uid'] != out_uid), None)
        if target is None:
            return
        self._lib.ac_set_setting(b'monitor_voice', 0.0)
        if self._lib.ac_start_monitor(target['uid'].encode()) != 0:
            print(f"[native] Pad preview unavailable on {target['name']}: {self._err()}")

    def restart_if_needed(self):
        """Watchdog: rebuild the stream after a device change or unplug."""
        st = self._stats
        if st.get('running') and st.get('device_changed') and self._input_idx is not None:
            print("[native] Device changed; restarting stream")
            mon = self.monitor_device
            self.start(self._input_idx, self._output_idx)
            if mon is not None:
                self.start_monitor(mon)

    # ── Settings ──────────────────────────────────────────────────────────────

    def _push_settings(self):
        s = self._lib.ac_set_setting
        s(b'vol_mic', self.vol_mic)
        s(b'vol_voice', self.vol_voice)
        s(b'vol_sound', self.vol_sound)
        s(b'vol_monitor', self.vol_monitor)
        s(b'gate_enabled', 1.0 if self.noise_gate_enabled else 0.0)
        s(b'gate_db', self.noise_gate_level)
        s(b'bypass', 1.0 if self.bypass_value else 0.0)
        s(b'mute', 1.0 if self.muted else 0.0)
        mode = NR_MODES.get(self.noise_reduction_mode, 2) if self.noise_reduction_enabled else 0
        s(b'nr_mode', float(mode))
        s(b'nr_strength', float(self.noise_reduction_strength))

    def set_audio_settings(self, settings: dict):
        for k in ('vol_mic', 'vol_voice', 'vol_sound', 'vol_monitor'):
            if k in settings:
                setattr(self, k, float(settings[k]))
        if 'noise_gate_enabled' in settings:
            self.noise_gate_enabled = bool(settings['noise_gate_enabled'])
        if 'noise_gate_level' in settings:
            self.noise_gate_level = float(settings['noise_gate_level'])
        if 'noise_reduction_enabled' in settings:
            self.noise_reduction_enabled = bool(settings['noise_reduction_enabled'])
        if settings.get('noise_reduction_mode') in NR_MODES:
            self.noise_reduction_mode = settings['noise_reduction_mode']
        if 'noise_reduction_strength' in settings:
            self.noise_reduction_strength = min(1.0, max(0.0, float(settings['noise_reduction_strength'])))
        self._push_settings()

    def get_audio_settings(self) -> dict:
        return {
            'vol_mic': self.vol_mic, 'vol_voice': self.vol_voice,
            'vol_sound': self.vol_sound, 'vol_monitor': self.vol_monitor,
            'noise_reduction_enabled': self.noise_reduction_enabled,
            'noise_reduction_mode': self.noise_reduction_mode,
            'noise_reduction_strength': self.noise_reduction_strength,
            'noise_gate_enabled': self.noise_gate_enabled,
            'noise_gate_level': self.noise_gate_level,
        }

    # ── Soundboard ────────────────────────────────────────────────────────────

    def _queue(self, data: np.ndarray, sr: float):
        data = np.ascontiguousarray(data, dtype=np.float32)
        if len(data) > 1:
            self._lib.ac_queue_sound(data.ctypes.data_as(ctypes.POINTER(ctypes.c_float)), len(data), float(sr))

    def set_mute(self, value: bool):
        self.muted = bool(value)
        self._lib.ac_set_setting(b'mute', 1.0 if self.muted else 0.0)

    def play_sound(self, sound_id, monitor_device: int | None = None):
        """Play a soundboard sound (library id like 'u12ab' / 'b3', or a built-in index)."""
        from soundlib import resolve_id
        sid = resolve_id(sound_id)
        data = self.library.audio(sid) if self.library else None
        if data is None:
            from engine import generate_sound
            data = generate_sound(int(sound_id) if str(sound_id).isdigit() else 0, self.SR)
        loop = bool(self.library and (self.library.get(sid) or {}).get('loop'))
        self._sound_gen += 1
        gen = self._sound_gen
        data = np.ascontiguousarray(data, dtype=np.float32)
        P = ctypes.POINTER(ctypes.c_float)
        self._lib.ac_play_sound(data.ctypes.data_as(P), len(data), float(self.SR))
        if loop:
            def _again():
                dur = len(data) / self.SR
                while True:
                    time.sleep(max(0.05, dur - 0.25))
                    if self._sound_gen != gen:
                        return
                    self._lib.ac_queue_sound(data.ctypes.data_as(P), len(data), float(self.SR))
            threading.Thread(target=_again, daemon=True).start()

    def play_file(self, filepath: str):
        if not filepath or not os.path.exists(filepath):
            print(f"[soundboard] File not found: {filepath}")
            return

        def _load():
            try:
                tmp = os.path.join(tempfile.gettempdir(), 'aurora_sound.wav')
                subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEF32@48000', '-c', '1', filepath, tmp],
                               check=True, capture_output=True)
                with wave.open(tmp, 'rb') as wf:
                    data = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.float32)
                self._queue(np.clip(np.nan_to_num(data), -1, 1), 48000)
            except Exception as e:
                self.last_error = f'Soundboard file error: {e}'

        threading.Thread(target=_load, daemon=True).start()

    def stop_sounds(self):
        self._sound_gen += 1  # ends any loop
        self._lib.ac_clear_sounds()

    # ── Stats ─────────────────────────────────────────────────────────────────

    def stats(self, max_age: float = 0.02) -> dict:
        now = time.monotonic()
        with self._lock:
            if now - self._stats_at > max_age:
                self._stats = self._json_call(self._lib.ac_get_stats) or {}
                self._stats_at = now
            return self._stats

    def get_level(self) -> dict:
        st = self.stats()
        return {
            'input_rms_db': st.get('input_rms_db', -96.0),
            'output_rms_db': st.get('output_rms_db', -96.0),
            'gate_rms_db': st.get('gate_rms_db', -96.0),
            'running': st.get('running', False),
            'monitoring': self.is_monitoring(),
            'bypass': self.bypass_value,
            'muted': self.muted,
            'sound_playing': st.get('sound_remaining_ms', 0) > 0,
            'voice': self.active_voice_id,
        }

    def get_spectrum(self, bands: int = 24) -> list[float]:
        return list(self.stats().get('bands', [0.0] * bands))[:bands]

    def get_latency(self) -> dict:
        st = self.stats()
        lat = st.get('latency', {})
        out = {
            'block_ms': lat.get('block_ms', 0.0),
            'input_ms': lat.get('input_ms', 0.0),
            'output_ms': lat.get('output_ms', 0.0),
            'algo_ms': lat.get('dsp_ms', 0.0) + lat.get('nr_ms', 0.0),  # look-ahead: effects + noise removal
            'nr_ms': lat.get('nr_ms', 0.0),
            'sample_rate': st.get('sample_rate', self.SR),
            'ring_ms': lat.get('ring_ms', 0.0),       # cross-device clock bridge
            'total_ms': lat.get('total_ms', 0.0),
            'dsp_ms': st.get('dsp_time_ms', 0.0),     # processing time per block
            'cpu': st.get('cpu', 0.0),
            'xruns': st.get('xruns', 0),
            'backend': 'native',
        }
        if self._measured_ms is not None:
            out['measured_ms'] = round(self._measured_ms, 2)
        return out

    def measure_latency(self) -> dict:
        res = self._json_call(self._lib.ac_measure_loopback) or {}
        if res.get('ok'):
            self._measured_ms = float(res['measured_ms'])
            print(f"[native] Loopback: {self._measured_ms:.2f} ms "
                  f"(path {res['measured_path_ms']:.2f} + converter {res['input_converter_ms']:.2f})")
        else:
            self.last_error = self._err() or 'Loopback measurement failed'
        self._stats_at = 0
        return self.get_latency()

    def render_offline(self, config: dict, audio: np.ndarray, sr: int = 48000, block: int = 128):
        """Run a voice config over a buffer (tests, previews). Returns (out, latency_samples)."""
        x = np.ascontiguousarray(audio, dtype=np.float32)
        y = np.zeros_like(x)
        P = ctypes.POINTER(ctypes.c_float)
        lat = self._lib.ac_render_offline(json.dumps(config).encode(), x.ctypes.data_as(P),
                                          y.ctypes.data_as(P), len(x), float(sr), block)
        return y, lat
