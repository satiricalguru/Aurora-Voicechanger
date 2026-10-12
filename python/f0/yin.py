"""
YIN Pitch Detector
Fast YIN pitch (F0) estimator.
Based on: de Cheveigné & Kawahara (2002). "YIN, a fundamental frequency estimator
for speech and music." JASA 111(4), 1917–1930.
"""
import numpy as np


def yin_f0(audio: np.ndarray,
           sr: int = 48000,
           threshold: float = 0.15,
           min_freq: float = 70.0,
           max_freq: float = 500.0) -> float:
    """
    Estimate fundamental frequency (F0) using the YIN algorithm.

    Args:
        audio:     1-D float32 array of audio samples
        sr:        Sample rate in Hz
        threshold: YIN threshold (lower = more strict voicing detection)
        min_freq:  Minimum frequency to detect (Hz)
        max_freq:  Maximum frequency to detect (Hz)

    Returns:
        F0 in Hz, or 0.0 if unvoiced / not detected
    """
    n = len(audio)
    if n < 2:
        return 0.0

    min_lag = max(1, int(sr / max_freq))
    max_lag = min(n // 2, int(sr / min_freq))

    if min_lag >= max_lag:
        return 0.0

    tau_range = max_lag - min_lag

    # ── Step 1: Difference function (autocorrelation-based) ──────────
    # Fast FFT-based autocorrelation to avoid the slow O(N^2) python loop.
    x2 = audio.astype(np.float64) ** 2
    cumsum_x2 = np.concatenate([[0.0], np.cumsum(x2)])

    fft_len = 2 ** int(np.ceil(np.log2(2 * n)))
    X = np.fft.rfft(audio.astype(np.float64), n=fft_len)
    R = np.fft.irfft(X * np.conj(X))[:n]

    t = np.arange(min_lag, max_lag)
    term1 = cumsum_x2[n - t]
    term2 = cumsum_x2[n] - cumsum_x2[t]
    term3 = -2.0 * R[t]
    diff = term1 + term2 + term3

    # ── Step 2: Cumulative Mean Normalized Difference (vectorised) ───────
    # running_sum at tau = sum(diff[1..tau]).  Use cumsum to avoid Python loop.
    taus       = np.arange(1, tau_range, dtype=np.float64)
    cumsum_d   = np.cumsum(diff[1:tau_range])
    cmnd       = np.ones(tau_range, dtype=np.float64)
    safe_cumsum = np.where(cumsum_d > 0.0, cumsum_d, 1.0)   # avoid 0/0 NaN on silence
    cmnd[1:]   = np.where(cumsum_d > 0.0, diff[1:tau_range] * taus / safe_cumsum, 1.0)

    # ── Step 3: Absolute threshold search (vectorised first-hit) ─────────
    tau_est = -1
    below = np.where(cmnd[1:tau_range - 1] < threshold)[0]
    if below.size > 0:
        start = int(below[0]) + 1        # convert to cmnd index
        # Descend to local minimum from the first sub-threshold point
        while start + 1 < tau_range - 1 and cmnd[start + 1] < cmnd[start]:
            start += 1
        tau_est = start

    if tau_est == -1:
        # No value below threshold — take global minimum
        tau_est = int(np.argmin(cmnd[1:]) + 1)
        if cmnd[tau_est] > 0.5:
            return 0.0  # definitely unvoiced

    # ── Step 4: Parabolic interpolation for sub-sample accuracy ──────
    if 1 <= tau_est < tau_range - 1:
        s0 = cmnd[tau_est - 1]
        s1 = cmnd[tau_est]
        s2 = cmnd[tau_est + 1]
        denom = (2.0 * s1 - s0 - s2)
        if abs(denom) > 1e-10:
            delta = 0.5 * (s0 - s2) / denom
        else:
            delta = 0.0
        refined_tau = (tau_est + delta) + min_lag
    else:
        refined_tau = tau_est + min_lag

    if refined_tau <= 0:
        return 0.0

    return float(sr / refined_tau)


class YINDetector:
    """
    Stateful YIN detector with voiced/unvoiced smoothing.
    Designed for real-time chunk-by-chunk processing.
    """

    def __init__(self,
                 sr: int = 48000,
                 threshold: float = 0.15,
                 min_freq: float = 70.0,
                 max_freq: float = 500.0,
                 history_len: int = 5):
        self.sr = sr
        self.threshold = threshold
        self.min_freq = min_freq
        self.max_freq = max_freq
        self.history: list[float] = []
        self.history_len = history_len

    def detect(self, chunk: np.ndarray) -> float:
        """
        Detect F0 from an audio chunk. Returns smoothed F0 in Hz (0 = unvoiced).
        """
        f0 = yin_f0(chunk, self.sr, self.threshold, self.min_freq, self.max_freq)

        if f0 > 0:
            self.history.append(f0)
            if len(self.history) > self.history_len:
                self.history.pop(0)
            # Median smoothing to reject octave errors
            return float(np.median(self.history))
        else:
            return 0.0

    def rolling_mean(self) -> float:
        """Mean of voiced F0 history (for pitch-ratio computation)."""
        if not self.history:
            return 150.0  # default neutral
        return float(np.mean(self.history))
