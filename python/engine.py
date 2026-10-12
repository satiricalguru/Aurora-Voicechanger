"""
VoiceChanger Audio Engine — Synchronous DSP in CoreAudio callback.
All effects run synchronously inside the PortAudio callback (audio_callback).
At CHUNK=256 / 48 kHz the budget is ~5.3 ms per block, which is sufficient for
the current chain. Metering state is updated each block and read by ws_server.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import threading
import time as _time
import subprocess
import tempfile
import wave

import sounddevice as sd
import numpy as np

from effects.chain import EffectChain
from effects.noise_gate import NoiseGate
from effects.spectral_nr import SpectralNR
from voices.presets import VOICE_PRESETS
from voices.ai_personas import AI_PERSONAS


class AudioEngine:
    CHUNK = 256  # Reduced from 512 for lower latency
    SR    = 48000

    def __init__(self):
        self.active_chain      = EffectChain([])
        self.active_ai_persona = None
        # FIX #6: attack_ms 10ms → 1.5ms so plosives ('p','t','k') aren't clipped
        self.noise_gate        = NoiseGate(threshold_db=-44, attack_ms=1.5, release_ms=200.0, sr=self.SR)
        self.spectral_nr       = SpectralNR(sr=self.SR)
        self.bypass            = False

        # Audio Settings
        self.vol_mic     = 1.0
        self.vol_voice   = 1.0
        self.vol_sound   = 1.0
        self.vol_monitor = 1.0
        self.noise_reduction_enabled = False
        self.noise_gate_enabled      = True

        # Streams
        self.stream:         sd.Stream | None = None
        self.monitor_stream: sd.OutputStream | None = None
        self.monitor_device: int | None = None

        # FIX #5: lock only guards set_voice() writes; audio_callback reads attrs without lock.
        # CPython GIL makes single LOAD_ATTR/STORE_ATTR atomic — sufficient for chain swap.
        self._lock = threading.Lock()

        # Output buffer — written and read within the same PortAudio stream callback.
        self._out_buf = np.zeros(self.CHUNK, dtype=np.float32)

        # FIX #3: double-buffer for monitor to avoid race between two different
        # PortAudio stream threads (main stream ≠ monitor stream on macOS CoreAudio).
        # audio_callback writes to _mon_bufs[1 - _mon_wi], then flips _mon_wi.
        # monitor_callback always reads _mon_bufs[_mon_wi] (the last fully written copy).
        self._mon_bufs = [
            np.zeros(self.CHUNK, dtype=np.float32),
            np.zeros(self.CHUNK, dtype=np.float32),
        ]
        self._mon_wi = 0  # index of the buffer last written by audio_callback

        # Performance metering (real numbers, not estimates)
        self._dsp_ms_avg  = 0.0     # smoothed DSP time per block
        self._xruns       = 0       # PortAudio over/underflow count
        self.active_voice_id: str | None = None

        # Metering
        self.input_rms_db  = -96.0
        self.output_rms_db = -96.0
        self.noise_gate.last_rms_db = -96.0

    # ── Voice selection ────────────────────────────────────────────────────────

    def set_voice(self, preset_id: str):
        # FIX #5: build the new chain/persona OUTSIDE the lock to keep the
        # critical section as short as possible.
        if preset_id in VOICE_PRESETS:
            new_chain   = EffectChain.from_preset(VOICE_PRESETS[preset_id])
            new_persona = None
            print(f"[engine] Voice: {VOICE_PRESETS[preset_id]['name']}")
        elif preset_id in AI_PERSONAS:
            from effects.ai_voice import AIVoicePersona
            new_chain   = EffectChain([])
            new_persona = AIVoicePersona(preset_id)
            print(f"[engine] AI Persona: {AI_PERSONAS[preset_id]['name']}")
        else:
            print(f"[engine] Unknown preset: {preset_id}")
            return
        # Atomic swap under GIL — audio_callback reads these with bare LOAD_ATTR
        with self._lock:
            self.active_ai_persona = new_persona
            self.active_chain      = new_chain
            self.active_voice_id   = preset_id

    def set_custom_chain(self, stages: list[dict]):
        """Build a chain from Voice Lab stages: [{'effect': 'pitch', 'semitones': 3}, ...]."""
        new_chain = EffectChain.from_preset({'chain': stages})
        with self._lock:
            self.active_ai_persona = None
            self.active_chain      = new_chain
            self.active_voice_id   = 'custom'
        print(f"[engine] Custom chain: {[st.get('effect') for st in stages]}")

    # ── CoreAudio callback ─────────────────────────────────────────────────────

    def audio_callback(self, indata, outdata, frames, time, status):
        """
        Runs in the CoreAudio real-time thread.
        Synchronously runs DSP on the input block and outputs the result.
        """
        t0 = _time.perf_counter()
        if status:
            self._xruns += 1
        audio = indata[:, 0].copy()

        # Input level meter
        rms = float(np.sqrt(np.mean(audio * audio)) + 1e-9)
        self.input_rms_db = 20.0 * np.log10(rms)

        # FIX #4: capture raw RMS before vol_mic so the NR gate threshold
        # comparison is independent of the mic volume slider.
        raw_rms = rms

        # Apply Mic Volume
        audio = audio * self.vol_mic

        if not self.bypass:
            # Spectral Subtraction Noise Reduction — calibrates on silence.
            if self.noise_reduction_enabled:
                nr_threshold = 10.0 ** (self.noise_gate.threshold_db / 20.0)
                if raw_rms < nr_threshold:          # use raw_rms, not vol_mic-scaled
                    self.spectral_nr.calibrate_frame(audio)
                else:
                    audio = self.spectral_nr.apply(audio)

            # Noise gate
            if self.noise_gate_enabled:
                audio = self.noise_gate.apply(audio)
            else:
                rms2 = float(np.sqrt(np.mean(audio * audio)) + 1e-9)
                self.noise_gate.last_rms_db = 20.0 * np.log10(rms2)

            # FIX #5: read chain/persona without lock — single LOAD_ATTR is
            # GIL-atomic in CPython; set_voice() does atomic STORE_ATTR under lock.
            persona = self.active_ai_persona
            chain   = self.active_chain

            if persona is not None:
                try:
                    audio = persona.apply(audio)
                except Exception:
                    audio = np.zeros(self.CHUNK, dtype=np.float32)
            else:
                try:
                    audio = chain.apply(audio)
                except Exception:
                    audio = np.zeros(self.CHUNK, dtype=np.float32)

        # Apply Voice Volume
        audio = audio * self.vol_voice

        # Safety: kill any NaN/Inf that leaked through
        audio = np.nan_to_num(audio, nan=0.0, posinf=1.0, neginf=-1.0)
        np.clip(audio, -1.0, 1.0, out=self._out_buf)

        # FIX #3: write to the idle double-buffer slot, then flip the index.
        # monitor_callback always reads the last fully-written slot via _mon_wi.
        wi = 1 - self._mon_wi
        self._mon_bufs[wi][:] = self._out_buf   # fill idle slot
        self._mon_wi = wi                        # single int assign → atomic under GIL

        # Output meter
        rms_out = float(np.sqrt(np.mean(self._out_buf * self._out_buf)) + 1e-9)
        self.output_rms_db = 20.0 * np.log10(rms_out)

        # Copy to output
        outdata[:] = self._out_buf.reshape(-1, 1)

        dt = (_time.perf_counter() - t0) * 1000.0
        self._dsp_ms_avg += 0.05 * (dt - self._dsp_ms_avg)

    def monitor_callback(self, outdata, frames, time, status):
        """Monitor stream: duplicate processed output to headphones (thread-safe via double-buffer)."""
        outdata[:] = (self._mon_bufs[self._mon_wi] * self.vol_monitor).reshape(-1, 1)

    # ── Stream management ──────────────────────────────────────────────────────

    def start(self, input_idx: int, output_idx: int):
        self.stop()
        try:
            self.stream = sd.Stream(
                samplerate=self.SR,
                blocksize=self.CHUNK,
                dtype='float32',
                channels=1,
                device=(input_idx, output_idx),
                callback=self.audio_callback,
                latency=0.0,   # smallest buffers the device allows; 'low' adds ~65 ms on duplex streams across two devices
            )
            self.stream.start()
            print(f"[engine] Stream started: in={input_idx} out={output_idx} {self.SR}Hz/{self.CHUNK}chunk")
        except Exception as e:
            print(f"[engine] Stream error: {e}")
            self.stream = None

    def stop(self):
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
        self.stop_monitor()
        print("[engine] Stream stopped")

    def is_running(self) -> bool:
        return self.stream is not None and self.stream.active

    # ── Monitor (Hear Yourself) ────────────────────────────────────────────────

    def start_monitor(self, device_idx: int):
        """Start monitoring processed audio on a speaker/headphone device."""
        self.stop_monitor()
        self.monitor_device = device_idx
        try:
            self.monitor_stream = sd.OutputStream(
                samplerate=self.SR,
                blocksize=self.CHUNK,
                dtype='float32',
                channels=1,
                device=device_idx,
                callback=self.monitor_callback,
                latency=0.0,   # smallest buffers the device allows; 'low' adds ~65 ms on duplex streams across two devices
            )
            self.monitor_stream.start()
            print(f"[engine] Monitor started on device {device_idx}")
        except Exception as e:
            print(f"[engine] Monitor error: {e}")
            self.monitor_stream = None

    def stop_monitor(self):
        if self.monitor_stream:
            try:
                self.monitor_stream.stop()
                self.monitor_stream.close()
            except Exception:
                pass
            self.monitor_stream = None
            self.monitor_device = None
            print("[engine] Monitor stopped")

    def is_monitoring(self) -> bool:
        return self.monitor_stream is not None and self.monitor_stream.active

    # ── Soundboard ────────────────────────────────────────────────────────────

    def play_sound(self, sound_id: int, monitor_device: int | None = None):
        """Generate and play a soundboard tone on the monitor or output device."""
        sr = self.SR
        duration = 2.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)

        # Different sounds per slot
        sounds = {
            0:  lambda t: np.sin(2*np.pi*440*t) * np.exp(-t*2),            # Air Horn
            1:  lambda t: _crowd_applause(t, sr),                           # Applause
            2:  lambda t: _drum_roll(t, sr),                                # Drum Roll
            3:  lambda t: np.sin(2*np.pi*180*t) * (1 + 0.5*np.sin(2*np.pi*8*t)),  # Laugh
            4:  lambda t: np.random.randn(len(t)) * 0.05 * np.exp(-t*0.3), # Crickets
            5:  lambda t: np.sin(2*np.pi*200*t) * np.exp(-t*5) * 0.8,     # Oof
            6:  lambda t: _sad_trombone(t, sr),                             # Trombone
            7:  lambda t: np.sin(2*np.pi*60*t) * np.exp(-t*1),             # Vine Boom
            8:  lambda t: _airhorn(t, sr),                                   # MLG Horn
            9:  lambda t: np.random.randn(len(t)) * 0.03 * np.sin(t),       # Night
            10: lambda t: _ba_dum_tss(t, sr),                               # Ba Dum Tss
            11: lambda t: np.sin(2*np.pi*880*t) * np.exp(-t*3),             # XP
        }

        fn = sounds.get(sound_id % 12, sounds[0])
        wave_data = fn(t).astype(np.float32)
        wave_data = np.nan_to_num(wave_data, nan=0.0)
        np.clip(wave_data, -1.0, 1.0, out=wave_data)

        # Apply sound volume
        wave_data = wave_data * self.vol_sound

        # Play on monitor device if set, else default output
        dev = monitor_device if monitor_device is not None else self.monitor_device
        try:
            sd.play(wave_data, sr, device=dev)
        except Exception as e:
            print(f"[engine] play_sound error: {e}")

    def play_file(self, filepath: str):
        if not filepath or not os.path.exists(filepath):
            print(f"[soundboard] File not found: {filepath}")
            return
            
        def _load_and_play():
            try:
                # Use afconvert to convert to standard 48kHz 32-bit float WAV
                temp_wav = os.path.join(tempfile.gettempdir(), 'voicechanger_temp.wav')
                cmd = ['afconvert', '-f', 'WAVE', '-d', 'LEF32@48000', '-c', '1', filepath, temp_wav]
                subprocess.run(cmd, check=True, capture_output=True)
                
                with wave.open(temp_wav, 'rb') as wf:
                    frames = wf.readframes(wf.getnframes())
                    wave_data = np.frombuffer(frames, dtype=np.float32)
                
                # Apply sound volume
                wave_data = np.nan_to_num(wave_data, nan=0.0)
                np.clip(wave_data, -1.0, 1.0, out=wave_data)
                wave_data = wave_data * self.vol_sound
                
                dev = self.monitor_device
                try:
                    sd.play(wave_data, samplerate=48000, blocking=False, device=dev)
                except Exception as e:
                    print(f"[soundboard] Play file error: {e}")
                    
            except Exception as e:
                print(f"[soundboard] Failed to play file: {e}")
                
        threading.Thread(target=_load_and_play, daemon=True).start()

    # ── Device discovery ───────────────────────────────────────────────────────

    def get_devices(self) -> list[dict]:
        devs = sd.query_devices()
        result = []
        for i, d in enumerate(devs):
            result.append({
                'index': i,
                'name': d['name'],
                'inputs':  d['max_input_channels'],
                'outputs': d['max_output_channels'],
                'is_blackhole':    'BlackHole' in d['name'],
                'is_default_input':  i == sd.default.device[0],
                'is_default_output': i == sd.default.device[1],
                'sample_rate': int(d['default_samplerate']),
            })
        return result

    def find_blackhole(self) -> int | None:
        for d in self.get_devices():
            if d['is_blackhole'] and d['outputs'] > 0:
                return d['index']
        return None

    def find_default_output(self) -> int | None:
        """Return a speaker/headphone output (not BlackHole) for monitoring."""
        for d in self.get_devices():
            if d['outputs'] > 0 and not d['is_blackhole']:
                if d['is_default_output']:
                    return d['index']
        for d in self.get_devices():
            if d['outputs'] > 0 and not d['is_blackhole']:
                return d['index']
        return None

    def set_audio_settings(self, settings: dict):
        with self._lock:
            if 'vol_mic' in settings:     self.vol_mic = float(settings['vol_mic'])
            if 'vol_voice' in settings:   self.vol_voice = float(settings['vol_voice'])
            if 'vol_sound' in settings:   self.vol_sound = float(settings['vol_sound'])
            if 'vol_monitor' in settings: self.vol_monitor = float(settings['vol_monitor'])
            if 'noise_reduction_enabled' in settings:
                new_nr = bool(settings['noise_reduction_enabled'])
                if new_nr and not self.noise_reduction_enabled:
                    # Re-calibrate when NR is freshly enabled
                    self.spectral_nr.reset_calibration()
                self.noise_reduction_enabled = new_nr
            if 'noise_gate_enabled' in settings:      self.noise_gate_enabled = bool(settings['noise_gate_enabled'])
            if 'noise_gate_level' in settings:
                self.noise_gate.threshold_db = float(settings['noise_gate_level'])
                self.spectral_nr.set_gate_threshold(float(settings['noise_gate_level']))

    def get_audio_settings(self) -> dict:
        return {
            'vol_mic': self.vol_mic,
            'vol_voice': self.vol_voice,
            'vol_sound': self.vol_sound,
            'vol_monitor': self.vol_monitor,
            'noise_reduction_enabled': self.noise_reduction_enabled,
            'noise_gate_enabled': self.noise_gate_enabled,
            'noise_gate_level': self.noise_gate.threshold_db,
        }

    def get_latency(self) -> dict:
        """
        Latency as reported by CoreAudio/PortAudio for the live stream, plus the
        block we wait for. This is the device-side figure; a loopback click test
        is still the ground truth for end-to-end delay.
        """
        block_ms = self.CHUNK / self.SR * 1000.0
        io_in = io_out = 0.0
        if self.stream is not None:
            try:
                io_in, io_out = self.stream.latency
            except Exception:
                pass
        total = block_ms + (io_in + io_out) * 1000.0
        return {
            'block_ms':  round(block_ms, 2),
            'input_ms':  round(io_in * 1000.0, 2),
            'output_ms': round(io_out * 1000.0, 2),
            'total_ms':  round(total, 2),
            'dsp_ms':    round(self._dsp_ms_avg, 3),
            'cpu':       round(float(self.stream.cpu_load), 3) if self.stream is not None else 0.0,
            'xruns':     self._xruns,
        }

    def get_spectrum(self, bands: int = 24) -> list[float]:
        """Log-spaced magnitude bands (0..1) of the latest processed block, for visuals."""
        buf = self._mon_bufs[self._mon_wi]
        mag = np.abs(np.fft.rfft(buf * np.hanning(len(buf))))
        n = len(mag)
        edges = np.unique(np.geomspace(1, n - 1, bands + 1).astype(int))
        out = []
        for a, b in zip(edges[:-1], edges[1:]):
            v = float(mag[a:max(b, a + 1)].mean())
            out.append(round(min(1.0, max(0.0, (20 * np.log10(v + 1e-9) + 60) / 60)), 3))
        while len(out) < bands:
            out.append(0.0)
        return out

    def get_level(self) -> dict:
        return {
            'input_rms_db':  round(self.input_rms_db,  1),
            'output_rms_db': round(self.output_rms_db, 1),
            'gate_rms_db':   round(self.noise_gate.last_rms_db, 1),
            'running':       self.is_running(),
            'monitoring':    self.is_monitoring(),
            'bypass':        self.bypass,
            'voice':         self.active_voice_id,
        }

    def set_param(self, effect: str, param: str, value):
        with self._lock:
            self.active_chain.set_param(effect, param, value)


# ── Soundboard tone generators ─────────────────────────────────────────────────

def _crowd_applause(t, sr):
    noise = np.random.randn(len(t)) * 0.3
    env = np.minimum(t / 0.2, 1.0) * np.exp(-t * 0.5)
    return noise * env

def _drum_roll(t, sr):
    # Rapid clicks
    period = int(sr * 0.05)
    wave = np.zeros(len(t))
    for i in range(0, len(t), period):
        if i < len(wave):
            wave[i:i+min(period//4, len(wave)-i)] = np.sin(
                np.linspace(0, np.pi, min(period//4, len(wave)-i))
            ) * 0.8
    return wave * np.minimum(t / 0.5, 1.0)

def _sad_trombone(t, sr):
    freqs = [392, 349, 330, 294]
    seg = len(t) // 4
    wave = np.zeros(len(t))
    for i, f in enumerate(freqs):
        s = i * seg
        e = min(s + seg, len(t))
        wave[s:e] = np.sin(2 * np.pi * f * t[s:e]) * 0.6
    return wave

def _airhorn(t, sr):
    return np.clip(np.sin(2 * np.pi * 550 * t) * 2.0 + np.sin(2 * np.pi * 680 * t), -1, 1) * 0.7

def _ba_dum_tss(t, sr):
    # ba (snare), ba (snare), tss (hi-hat)
    wave = np.zeros(len(t))
    seg = len(t) // 4
    for beat_t in [0, seg]:
        if beat_t < len(wave):
            end = min(beat_t + seg // 2, len(wave))
            wave[beat_t:end] = np.random.randn(end - beat_t) * np.exp(-np.arange(end - beat_t) / (sr * 0.05)) * 0.6
    tss_start = seg * 3
    if tss_start < len(wave):
        tss_dur = len(wave) - tss_start
        env = np.exp(-np.arange(tss_dur) / (sr * 0.3))
        wave[tss_start:] = np.random.randn(tss_dur) * env * 0.3
    return wave
