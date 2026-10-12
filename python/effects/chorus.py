"""
Chorus / Flanger / Vibrato / Delay / Wah-Wah Effects
Chorus, vibrato, delay and wah modulation effects.
All use pre-allocated ring buffers — no dynamic allocation in apply().
"""
import numpy as np
import scipy.signal
from .base import BaseEffect


class ChorusEffect(BaseEffect):
    """
    Multi-voice chorus with LFO-modulated circular delay line.
    rate_hz:  LFO rate in Hz (0.1–10)
    depth_ms: max delay modulation depth in ms
    feedback: feedback amount (0–0.9)
    voices:   number of chorus voices (1–4)
    wet:      wet/dry mix
    """

    MAX_DELAY_MS = 50.0

    def __init__(self,
                 rate: float = 1.5,
                 depth: float = 10.0,
                 feedback: float = 0.2,
                 voices: int = 2,
                 wet: float = 0.5,
                 sr: int = 48000):
        self.rate = rate
        self.depth = depth
        self.feedback = feedback
        self.voices = min(max(voices, 1), 4)
        self.wet = wet
        self.sr = sr

        max_delay = int(self.MAX_DELAY_MS * 0.001 * sr) + 2
        self._buf = np.zeros(max_delay, dtype=np.float32)
        self._ptr = 0
        self._buf_size = max_delay
        # FIX #14: cap effective feedback so voices*feedback < 0.9 (avoids runaway)
        self._safe_feedback = min(self.feedback, 0.9 / max(self.voices, 1))
        # LFO phases — spread evenly for chorus width
        self._lfo_phases = [i / self.voices for i in range(self.voices)]

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)
        depth_samples = self.depth * 0.001 * self.sr
        lfo_inc = self.rate / self.sr
        
        idx_write = (self._ptr + np.arange(n)) % self._buf_size
        voice_sums = np.zeros(n, dtype=np.float32)
        
        for v in range(self.voices):
            phases = (self._lfo_phases[v] + np.arange(n) * lfo_inc) % 1.0
            self._lfo_phases[v] = (self._lfo_phases[v] + n * lfo_inc) % 1.0
            lfo = 0.5 * (1.0 + np.sin(2.0 * np.pi * phases))
            delay_samp = depth_samples * lfo + (self.voices - 1) * 5
            delay_int = delay_samp.astype(np.int32)
            frac = (delay_samp - delay_int).astype(np.float32)
            
            idx0 = (idx_write - delay_int) % self._buf_size
            idx1 = (idx_write - delay_int - 1) % self._buf_size
            
            voice_sums += (1.0 - frac) * self._buf[idx0] + frac * self._buf[idx1]
            
        voice_sums /= self.voices
        self._buf[idx_write] = chunk + voice_sums * self._safe_feedback
        
        output = chunk * (1.0 - self.wet) + voice_sums * self.wet
        self._ptr = (self._ptr + n) % self._buf_size
        return output


class VibratoEffect(BaseEffect):
    """Single-voice vibrato (pitch modulation via delay modulation)."""

    MAX_DELAY_MS = 30.0

    def __init__(self,
                 rate: float = 5.0,
                 depth: float = 0.3,
                 sr: int = 48000):
        self.rate = rate
        self.depth = depth
        self.sr = sr
        max_delay = int(self.MAX_DELAY_MS * 0.001 * sr) + 2
        self._buf = np.zeros(max_delay, dtype=np.float32)
        self._ptr = 0
        self._buf_size = max_delay
        self._lfo_phase = 0.0

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)
        depth_s = self.depth * 5.0 * self.sr / 1000.0
        lfo_inc = self.rate / self.sr

        # Write chunk to circular buffer
        idx_write = (self._ptr + np.arange(n)) % self._buf_size
        self._buf[idx_write] = chunk

        # Compute LFO array
        phases = (self._lfo_phase + np.arange(n) * lfo_inc) % 1.0
        self._lfo_phase = (self._lfo_phase + n * lfo_inc) % 1.0
        lfo = 0.5 * (1.0 + np.sin(2.0 * np.pi * phases))

        # Compute delay indices
        delay_s = depth_s * lfo + 2.0
        d_int = delay_s.astype(np.int32)
        frac = (delay_s - d_int).astype(np.float32)

        idx0 = (idx_write - d_int) % self._buf_size
        idx1 = (idx_write - d_int - 1) % self._buf_size

        output = (1.0 - frac) * self._buf[idx0] + frac * self._buf[idx1]
        self._ptr = (self._ptr + n) % self._buf_size

        return output


class DelayEffect(BaseEffect):
    """
    Fixed-time delay line with feedback.
    delay_ms:  delay time in ms
    feedback:  feedback coefficient (0–0.95)
    wet:       wet/dry mix
    """

    def __init__(self,
                 delay_ms: float = 250.0,
                 feedback: float = 0.3,
                 wet: float = 0.4,
                 sr: int = 48000):
        self.delay_ms = delay_ms
        self.feedback = feedback
        self.wet = wet
        self.sr = sr
        self._build()

    def _build(self):
        n = max(1, int(self.delay_ms * 0.001 * self.sr))
        self._buf = np.zeros(n, dtype=np.float32)
        self._ptr = 0
        self._buf_size = n

    def set_param(self, key, value):
        super().set_param(key, value)
        self._build()

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)
        idx = (self._ptr + np.arange(n)) % self._buf_size
        delayed = self._buf[idx].copy()
        
        self._buf[idx] = chunk + delayed * self.feedback
        output = chunk * (1.0 - self.wet) + delayed * self.wet
        
        self._ptr = (self._ptr + n) % self._buf_size
        return output


class WahEffect(BaseEffect):
    """
    Auto-wah: LFO sweeps a bandpass filter center frequency.
    rate:   LFO rate Hz
    depth:  sweep depth (0–1)
    """

    def __init__(self,
                 rate: float = 2.0,
                 depth: float = 0.7,
                 sr: int = 48000):
        self.rate = rate
        self.depth = depth
        self.sr = sr
        self._lfo_phase = 0.0
        # Biquad state
        self._bp_zi = np.zeros(2, dtype=np.float64)

    def _biquad_bandpass(self, chunk: np.ndarray, freq: float, Q: float = 2.0) -> np.ndarray:
        """Apply biquad bandpass filter."""
        w0 = 2.0 * np.pi * freq / self.sr
        cos_w0 = np.cos(w0)
        sin_w0 = np.sin(w0)
        alpha = sin_w0 / (2.0 * Q)
        b0 = sin_w0 / 2.0
        b1 = 0.0
        b2 = -sin_w0 / 2.0
        a0 = 1.0 + alpha
        a1 = -2.0 * cos_w0
        a2 = 1.0 - alpha

        # Normalize coefficients
        b_coeff = np.array([b0, b1, b2], dtype=np.float64) / a0
        a_coeff = np.array([1.0, a1/a0, a2/a0], dtype=np.float64)

        out_double, self._bp_zi = scipy.signal.lfilter(b_coeff, a_coeff, chunk.astype(np.float64), zi=self._bp_zi)
        return out_double.astype(np.float32)

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        lfo_inc = self.rate / self.sr
        lfo = 0.5 * (1.0 + np.sin(2.0 * np.pi * self._lfo_phase))
        self._lfo_phase = (self._lfo_phase + lfo_inc * len(chunk)) % 1.0

        # Sweep center frequency (300 Hz – 3000 Hz)
        center = 300.0 + lfo * self.depth * 2700.0
        filtered = self._biquad_bandpass(chunk, center, Q=3.0)
        return chunk * (1.0 - self.depth) + filtered * self.depth
