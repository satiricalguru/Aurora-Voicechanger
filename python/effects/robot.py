"""
Robot / Vocoder Effect
Ring modulation + bandpass vocoder.
"""
import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi
from .base import BaseEffect


def _make_bandpass(low_hz: float, high_hz: float, sr: int):
    """Create a 2nd-order Butterworth bandpass SOS filter."""
    nyq = sr / 2.0
    low = max(low_hz / nyq, 0.001)
    high = min(high_hz / nyq, 0.999)
    if low >= high:
        high = min(low + 0.01, 0.999)
    return butter(2, [low, high], btype='bandpass', output='sos')


class RobotEffect(BaseEffect):
    """
    16-band vocoder with sawtooth carrier.
    carrier_freq: fundamental of the sawtooth (Hz)
    depth:        wet/dry mix of vocoder (0–1)
    """

    N_BANDS = 16
    BAND_FREQS = np.geomspace(80, 8000, N_BANDS + 1)  # log-spaced edges

    def __init__(self,
                 carrier_freq: float = 120.0,
                 depth: float = 0.8,
                 sr: int = 48000):
        self.carrier_freq = carrier_freq
        self.depth = depth
        self.sr = sr
        self._phase = 0.0
        self._carrier_buf: np.ndarray | None = None

        # Pre-compute bandpass filters and initial conditions
        self._sos_list = []
        self._zi_in = []
        self._zi_out = []
        for i in range(self.N_BANDS):
            lo = float(self.BAND_FREQS[i])
            hi = float(self.BAND_FREQS[i + 1])
            sos = _make_bandpass(lo, hi, sr)
            self._sos_list.append(sos)
            self._zi_in.append(sosfilt_zi(sos))
            self._zi_out.append(sosfilt_zi(sos))

        # Envelope followers per band
        self._env = np.zeros(self.N_BANDS, dtype=np.float32)
        self._env_attack = 1.0 - np.exp(-1.0 / (sr * 0.005))   # 5 ms
        self._env_release = 1.0 - np.exp(-1.0 / (sr * 0.050))  # 50 ms

    def _generate_carrier(self, n: int) -> np.ndarray:
        """Generate n samples of sawtooth wave at carrier_freq."""
        t = (np.arange(n) + self._phase) * self.carrier_freq / self.sr
        self._phase = (self._phase + n) % (self.sr / self.carrier_freq)
        # Sawtooth: 2*(t%1) - 1
        return (2.0 * (t % 1.0) - 1.0).astype(np.float32)

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)
        carrier = self._generate_carrier(n)
        output = np.zeros(n, dtype=np.float32)

        for i in range(self.N_BANDS):
            sos = self._sos_list[i]

            # Filter input through analysis band
            band_in, self._zi_in[i] = sosfilt(sos, chunk, zi=self._zi_in[i])

            # Envelope follower
            env_val = float(np.mean(np.abs(band_in)))
            if env_val > self._env[i]:
                self._env[i] += self._env_attack * (env_val - self._env[i])
            else:
                self._env[i] += self._env_release * (env_val - self._env[i])

            # Modulate carrier band by envelope
            modulated = (carrier * self._env[i]).astype(np.float32)

            # Filter modulated carrier through same synthesis band
            band_out, self._zi_out[i] = sosfilt(sos, modulated, zi=self._zi_out[i])
            output += band_out

        return chunk * (1.0 - self.depth) + output * self.depth
