"""
3-Band Parametric EQ
Three-band EQ: low shelf + peak + high shelf biquad IIR.
Uses scipy.signal with persistent filter state (zi) for continuous-chunk processing.
"""
import numpy as np
from scipy.signal import lfilter_zi, lfilter
from .base import BaseEffect


def _shelf_coeffs(freq: float, gain_db: float, shelf_type: str, sr: int):
    """Compute biquad coefficients for a shelf filter (low or high)."""
    A = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * freq / sr
    cos_w0 = np.cos(w0)
    sin_w0 = np.sin(w0)
    S = 1.0  # shelf slope
    alpha = sin_w0 / 2.0 * np.sqrt((A + 1.0 / A) * (1.0 / S - 1.0) + 2.0)

    if shelf_type == 'low':
        b0 =  A * ((A + 1) - (A - 1) * cos_w0 + 2 * np.sqrt(A) * alpha)
        b1 =  2 * A * ((A - 1) - (A + 1) * cos_w0)
        b2 =  A * ((A + 1) - (A - 1) * cos_w0 - 2 * np.sqrt(A) * alpha)
        a0 =        (A + 1) + (A - 1) * cos_w0 + 2 * np.sqrt(A) * alpha
        a1 = -2 *  ((A - 1) + (A + 1) * cos_w0)
        a2 =        (A + 1) + (A - 1) * cos_w0 - 2 * np.sqrt(A) * alpha
    else:  # high
        b0 =  A * ((A + 1) + (A - 1) * cos_w0 + 2 * np.sqrt(A) * alpha)
        b1 = -2 * A * ((A - 1) + (A + 1) * cos_w0)
        b2 =  A * ((A + 1) + (A - 1) * cos_w0 - 2 * np.sqrt(A) * alpha)
        a0 =        (A + 1) - (A - 1) * cos_w0 + 2 * np.sqrt(A) * alpha
        a1 =  2 *  ((A - 1) - (A + 1) * cos_w0)
        a2 =        (A + 1) - (A - 1) * cos_w0 - 2 * np.sqrt(A) * alpha

    return np.array([b0 / a0, b1 / a0, b2 / a0]), np.array([1.0, a1 / a0, a2 / a0])


def _peak_coeffs(freq: float, gain_db: float, Q: float, sr: int):
    """Compute biquad coefficients for a peaking EQ filter."""
    A = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * freq / sr
    cos_w0 = np.cos(w0)
    alpha = np.sin(w0) / (2.0 * Q)
    b0 = 1.0 + alpha * A
    b1 = -2.0 * cos_w0
    b2 = 1.0 - alpha * A
    a0 = 1.0 + alpha / A
    a1 = -2.0 * cos_w0
    a2 = 1.0 - alpha / A
    return np.array([b0 / a0, b1 / a0, b2 / a0]), np.array([1.0, a1 / a0, a2 / a0])


class EQEffect(BaseEffect):
    """
    3-band parametric EQ: low shelf + peak mid + high shelf.
    Gains in dB. Maintains filter state across chunks.
    """

    def __init__(self,
                 low: float = 0.0,
                 mid: float = 0.0,
                 high: float = 0.0,
                 low_freq: float = 200.0,
                 mid_freq: float = 1000.0,
                 high_freq: float = 4000.0,
                 mid_q: float = 0.7,
                 sr: int = 48000):
        self.low = low
        self.mid = mid
        self.high = high
        self.low_freq = low_freq
        self.mid_freq = mid_freq
        self.high_freq = high_freq
        self.mid_q = mid_q
        self.sr = sr
        self._build()

    def _build(self):
        """Recompute biquad coefficients and reset filter state."""
        self._b_low, self._a_low = _shelf_coeffs(self.low_freq, self.low, 'low', self.sr)
        self._b_mid, self._a_mid = _peak_coeffs(self.mid_freq, self.mid, self.mid_q, self.sr)
        self._b_high, self._a_high = _shelf_coeffs(self.high_freq, self.high, 'high', self.sr)

        self._zi_low = lfilter_zi(self._b_low, self._a_low)
        self._zi_mid = lfilter_zi(self._b_mid, self._a_mid)
        self._zi_high = lfilter_zi(self._b_high, self._a_high)

    def set_param(self, key, value):
        super().set_param(key, value)
        self._build()

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        x = chunk.astype(np.float64)
        x, self._zi_low  = lfilter(self._b_low,  self._a_low,  x, zi=self._zi_low)
        x, self._zi_mid  = lfilter(self._b_mid,  self._a_mid,  x, zi=self._zi_mid)
        x, self._zi_high = lfilter(self._b_high, self._a_high, x, zi=self._zi_high)
        return x.astype(np.float32)
