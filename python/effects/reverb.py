"""
Schroeder Reverb Effect
Schroeder reverb: 4 parallel comb filters + 2 all-pass filters.
Classic Schroeder (1962) topology with adjustable room_size, damping, and wet level.
"""
import numpy as np
import scipy.signal
from .base import BaseEffect


class _CombFilter:
    """Feedback comb filter with LPF damping (Moorer's modification)."""

    def __init__(self, delay_samples: int, room_size: float, damping: float):
        self.buf = np.zeros(delay_samples, dtype=np.float32)
        self.ptr = 0
        self.room_size = room_size
        self.damping = damping
        self._last = 0.0
        self.delay = delay_samples

    def process_chunk(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)
        idx = (self.ptr + np.arange(n)) % self.delay
        delayed = self.buf[idx].copy()
        
        # Apply LPF damping in feedback
        b = np.array([1.0 - self.damping], dtype=np.float64)
        a = np.array([1.0, -self.damping], dtype=np.float64)
        lpf_out, zi = scipy.signal.lfilter(b, a, delayed.astype(np.float64), zi=np.array([self._last], dtype=np.float64))
        self._last = float(zi[0])
        
        self.buf[idx] = chunk + lpf_out.astype(np.float32) * self.room_size
        self.ptr = (self.ptr + n) % self.delay
        return delayed


class _AllPassFilter:
    """Schroeder all-pass filter."""

    def __init__(self, delay_samples: int, gain: float = 0.5):
        self.buf = np.zeros(delay_samples, dtype=np.float32)
        self.ptr = 0
        self.gain = gain
        self.delay = delay_samples

    def process_chunk(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)
        out = np.empty(n, dtype=np.float32)
        buf = self.buf
        ptr = self.ptr
        d = self.delay
        g = self.gain
        for i in range(n):
            buf_out = float(buf[ptr])
            out[i] = -chunk[i] + buf_out
            buf[ptr] = chunk[i] + buf_out * g
            ptr = (ptr + 1) % d
        self.ptr = ptr
        return out


class ReverbEffect(BaseEffect):
    """
    Schroeder reverb: 4 combs + 2 all-pass.
    room:          room size (0–1, controls feedback gain)
    damping:       HF damping (0–1)
    wet:           wet/dry mix (0–1)
    pre_delay_ms:  pre-delay in milliseconds
    """

    # Classic Schroeder delay lines (samples @ 44100 Hz, scaled for 48000)
    _COMB_DELAYS_BASE  = [1557, 1617, 1491, 1422]
    _ALLPASS_DELAYS    = [225, 556]

    def __init__(self,
                 room: float = 0.4,  # Reduced from 0.5 for less muddiness
                 damping: float = 0.6,  # Increased from 0.5 for more HF damping
                 wet: float = 0.25,    # Reduced from 0.3
                 pre_delay_ms: float = 5.0,  # Added small pre-delay
                 sr: int = 48000):
        self.room = room
        self.damping = damping
        self.wet = wet
        self.pre_delay_ms = pre_delay_ms
        self.sr = sr
        self._build(room, damping, sr)

    def _build(self, room: float, damping: float, sr: int):
        scale = sr / 44100.0
        feedback = 0.5 + room * 0.42  # maps 0–1 to ~0.5–0.92
        self._combs = [
            _CombFilter(int(d * scale), feedback, damping)
            for d in self._COMB_DELAYS_BASE
        ]
        self._allpasses = [
            _AllPassFilter(int(d * scale), 0.5)
            for d in self._ALLPASS_DELAYS
        ]
        # Pre-delay ring buffer
        pre_samples = max(1, int(self.pre_delay_ms * 0.001 * sr))
        self._pre_buf = np.zeros(pre_samples, dtype=np.float32)
        self._pre_ptr = 0

    def set_param(self, key, value):
        super().set_param(key, value)
        self._build(self.room, self.damping, self.sr)

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)

        # Pre-delay (vectorized)
        idx_pre = (self._pre_ptr + np.arange(n)) % len(self._pre_buf)
        x_delayed = self._pre_buf[idx_pre].copy()
        self._pre_buf[idx_pre] = chunk
        self._pre_ptr = (self._pre_ptr + n) % len(self._pre_buf)

        # 4 parallel combs (vectorized)
        comb_sum = sum(c.process_chunk(x_delayed) for c in self._combs)
        comb_sum *= 0.25  # normalize

        # 2 series all-passes (vectorized)
        ap_out = comb_sum
        for ap in self._allpasses:
            ap_out = ap.process_chunk(ap_out)

        return chunk * (1.0 - self.wet) + ap_out * self.wet
