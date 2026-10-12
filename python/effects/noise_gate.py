"""
Noise Gate Effect
Noise gate with RMS-based gating, soft knee,
and optional spectral subtraction.
"""
import numpy as np
from .base import BaseEffect


class NoiseGate(BaseEffect):
    """
    RMS noise gate with soft knee, attack/release envelope.
    threshold_db: gate opens above this RMS level (default -40 dB)
    attack_ms:    time to open gate (default 2 ms)
    release_ms:   time to close gate (default 100 ms)
    """

    def __init__(self,
                 threshold_db: float = -40.0,
                 attack_ms: float = 2.0,
                 release_ms: float = 100.0,
                 sr: int = 48000):
        self.threshold_db = threshold_db
        self.attack_ms = attack_ms
        self.release_ms = release_ms
        self.sr = sr

        self._gain = 0.0
        self.last_rms_db = -96.0
        self._update_coeffs()

    def _update_coeffs(self):
        # One-pole IIR coefficients
        self._attack_coef = 1.0 - np.exp(-1.0 / (self.sr * self.attack_ms * 0.001))
        self._release_coef = 1.0 - np.exp(-1.0 / (self.sr * self.release_ms * 0.001))
        self._threshold_lin = 10.0 ** (self.threshold_db / 20.0)

    def set_param(self, key, value):
        super().set_param(key, value)
        self._update_coeffs()

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        rms = float(np.sqrt(np.mean(chunk ** 2)) + 1e-9)
        self.last_rms_db = 20.0 * np.log10(rms)

        target = 1.0 if rms > self._threshold_lin else 0.0

        # Build a per-sample gain envelope via geometric series so the gain
        # ramps smoothly within the chunk instead of stepping between chunks,
        # which prevents the audible click that a scalar-gain implementation causes.
        coef  = self._attack_coef if target > self._gain else self._release_coef
        alpha = 1.0 - coef          # decay per sample toward target
        n     = len(chunk)
        # gain[k] = target + (gain_0 - target) * alpha^k
        exps     = alpha ** np.arange(n, dtype=np.float32)
        gain_env = np.float32(target) + (np.float32(self._gain) - np.float32(target)) * exps
        # Advance the scalar gain state by n samples
        self._gain = float(target + (self._gain - target) * (alpha ** n))

        return chunk * gain_env


class NoiseInjectEffect(BaseEffect):
    """
    Injects colored noise (white, pink, brown) for radio/walkie-talkie effects.
    """

    def __init__(self,
                 color: str = 'white',
                 level: float = 0.03):
        self.color = color
        self.level = level
        self._prev = 0.0  # for pink/brown noise state

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)
        if self.color == 'white':
            noise = np.random.randn(n).astype(np.float32) * self.level
        elif self.color == 'pink':
            # Approximation using first-order IIR
            import scipy.signal
            white = np.random.randn(n).astype(np.float32)
            b_coeff = np.array([0.01], dtype=np.float64)
            a_coeff = np.array([1.0, -0.99], dtype=np.float64)
            pink = scipy.signal.lfilter(b_coeff, a_coeff, white.astype(np.float64)).astype(np.float32)
            noise = pink * self.level * 10
        else:  # brown
            import scipy.signal
            white = np.random.randn(n).astype(np.float32)
            b_coeff = np.array([0.02], dtype=np.float64)
            a_coeff = np.array([1.0, -1.0], dtype=np.float64)
            if not hasattr(self, '_brown_zi'):
                self._brown_zi = np.array([self._prev], dtype=np.float64)
            brown, self._brown_zi = scipy.signal.lfilter(b_coeff, a_coeff, white.astype(np.float64), zi=self._brown_zi)
            self._prev = float(self._brown_zi[0])
            noise = brown.astype(np.float32) * self.level * 0.5

        return chunk + noise
