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

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
_LIB_CANDIDATES = (
    os.environ.get('AURORA_CORE_LIB', ''),
    os.path.join(os.path.dirname(__file__), 'libaurora_core.dylib'),            # packaged
    os.path.join(_ROOT, 'native', 'aurora-core', 'build', 'libaurora_core.dylib'),  # dev
)

PERSONA_KEYS = ('target_f0_mean', 'resonance_shift', 'breathiness', 'roughness',
                'brightness', 'vibrato_rate', 'vibrato_depth')


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
        path = lib_path or find_library()
        if not path:
            raise OSError('libaurora_core.dylib not found (build native/aurora-core)')
        self._lib = ctypes.CDLL(path)
        self._bind()
        self.lib_path = path
        self.bypass_value = False
        self.vol_mic = self.vol_voice = self.vol_sound = self.vol_monitor = 1.0
        self.noise_reduction_enabled = False
        self.noise_gate_enabled = True
        self.noise_gate_level = -44.0
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
        else:
            self.last_error = f'Unknown voice: {preset_id}'
            return
        if self._check(self._lib.ac_set_chain(json.dumps(cfg).encode()), 'set_voice'):
            self.active_voice_id = preset_id
            self.last_error = None

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
            d['is_blackhole'] = 'blackhole' in d['name'].lower()
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

    def find_blackhole(self) -> int | None:
        for d in self.get_devices():
            if d['is_blackhole'] and d['outputs'] > 0:
                return d['index']
        return None

    def find_default_output(self) -> int | None:
        devs = self.get_devices()
        for d in devs:
            if d['outputs'] > 0 and not d['is_virtual'] and d['is_default_output']:
                return d['index']
        for d in devs:
            if d['outputs'] > 0 and not d['is_virtual'] and not d['is_blackhole']:
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
            print(f"[native] Stream started: {in_uid} -> {out_uid}")

    def stop(self):
        self._lib.ac_stop()
        self.monitor_device = None
        print("[native] Stream stopped")

    def is_running(self) -> bool:
        return bool(self._lib.ac_is_running())

    def start_monitor(self, device_idx: int):
        uid = self._uid(int(device_idx))
        if uid and self._check(self._lib.ac_start_monitor(uid.encode()), 'Monitor'):
            self.monitor_device = int(device_idx)

    def stop_monitor(self):
        self._lib.ac_stop_monitor()
        self.monitor_device = None

    def is_monitoring(self) -> bool:
        return bool(self._lib.ac_is_monitoring())

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
        self._push_settings()

    def get_audio_settings(self) -> dict:
        return {
            'vol_mic': self.vol_mic, 'vol_voice': self.vol_voice,
            'vol_sound': self.vol_sound, 'vol_monitor': self.vol_monitor,
            'noise_reduction_enabled': self.noise_reduction_enabled,
            'noise_gate_enabled': self.noise_gate_enabled,
            'noise_gate_level': self.noise_gate_level,
        }

    # ── Soundboard ────────────────────────────────────────────────────────────

    def _queue(self, data: np.ndarray, sr: float):
        data = np.ascontiguousarray(data, dtype=np.float32)
        if len(data) > 1:
            self._lib.ac_queue_sound(data.ctypes.data_as(ctypes.POINTER(ctypes.c_float)), len(data), float(sr))

    def play_sound(self, sound_id: int, monitor_device: int | None = None):
        from engine import generate_sound
        self._queue(generate_sound(sound_id, self.SR), self.SR)

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
            'monitoring': st.get('monitoring', False),
            'bypass': self.bypass_value,
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
            'algo_ms': lat.get('dsp_ms', 0.0),        # effect look-ahead (pitch etc.)
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
