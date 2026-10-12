"""
Spectral Subtraction Noise Reducer — real-time, stateful.

How it works:
  1. While the noise gate is closed (silence), accumulate a noise PSD estimate
     by averaging |STFT|² frames.
  2. During voice, subtract that estimate from the magnitude spectrum, with an
     over-subtraction factor (alpha) and a spectral floor (beta) to avoid
     "musical noise" artifacts (the hollow metallic ringing that naive NR causes).
  3. Smooth the output spectrum across frames with a first-order IIR to soften
     remaining artifacts.

Tuning:
  alpha = 2.0  — how aggressively to subtract noise (1.0 = exact, >1 = more aggressive)
  beta  = 0.05 — spectral floor as fraction of noise level (prevents zeroing bins)
  calibration_frames — how many silence frames to average for noise estimate
"""
import numpy as np


class SpectralNR:
    FFT  = 1024
    HOP  = 256

    def __init__(self,
                 sr: int = 48000,
                 alpha: float = 2.0,
                 beta: float = 0.05,
                 calibration_frames: int = 30):
        self.sr   = sr
        self.alpha = alpha
        self.beta  = beta
        self.calibration_frames = calibration_frames

        n_bins = self.FFT // 2 + 1
        self._noise_psd    = np.zeros(n_bins, dtype=np.float64)  # estimated noise power
        self._calib_count  = 0
        self._calibrated   = False

        # OLA buffers
        self._in_buf  = np.zeros(self.FFT, dtype=np.float32)
        self._out_buf = np.zeros(self.FFT + self.HOP, dtype=np.float32)
        self._window  = np.sqrt(np.hanning(self.FFT)).astype(np.float32)
        self._ola_gain = float(np.sum(self._window ** 2) / self.HOP) or 1.0

        # Previous output magnitude for IIR smoothing
        self._prev_mag = np.zeros(n_bins, dtype=np.float64)

        # Noise gate threshold for calibration gating (linear)
        self._gate_threshold_lin = 10.0 ** (-44.0 / 20.0)  # matches engine default

    def set_gate_threshold(self, threshold_db: float):
        self._gate_threshold_lin = 10.0 ** (threshold_db / 20.0)

    def calibrate_frame(self, chunk: np.ndarray):
        """Feed a silence frame to update the noise PSD estimate."""
        self._in_buf[:-self.HOP] = self._in_buf[self.HOP:]
        self._in_buf[-self.HOP:] = chunk[:self.HOP]
        frame = self._in_buf * self._window
        spec  = np.fft.rfft(frame, n=self.FFT)
        psd   = (np.abs(spec) ** 2).astype(np.float64)

        if self._calib_count == 0:
            self._noise_psd = psd
        else:
            # Running average
            self._noise_psd += (psd - self._noise_psd) / (self._calib_count + 1)

        self._calib_count += 1
        if self._calib_count >= self.calibration_frames:
            self._calibrated = True

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        """Apply spectral subtraction to one chunk. Returns same-length output."""
        H, N = self.HOP, self.FFT

        # Auto-calibrate on silence if not yet calibrated
        if not self._calibrated:
            rms = float(np.sqrt(np.mean(chunk ** 2)) + 1e-9)
            if rms < self._gate_threshold_lin:
                self.calibrate_frame(chunk)
            # Pass through unmodified until calibrated
            return chunk.copy()

        # Shift input ring buffer
        self._in_buf[:-H] = self._in_buf[H:]
        self._in_buf[-H:] = chunk[:H]

        frame = self._in_buf * self._window
        spec  = np.fft.rfft(frame, n=N)
        mag   = np.abs(spec).astype(np.float64)
        phase = np.angle(spec)

        # Spectral subtraction with floor
        noise_mag  = np.sqrt(np.maximum(self._noise_psd, 1e-20))
        suppressed = mag - self.alpha * noise_mag
        floor      = self.beta * noise_mag
        new_mag    = np.maximum(suppressed, floor)

        # IIR smoothing across frames — FIX #7: 0.4*prev (was 0.7) halves the
        # time constant from ~15ms to ~7ms, preserving sibilants and plosives.
        new_mag = 0.6 * new_mag + 0.4 * self._prev_mag
        self._prev_mag = new_mag

        # Reconstruct
        new_spec  = new_mag * np.exp(1j * phase)
        out_frame = np.fft.irfft(new_spec, n=N).real.astype(np.float32)

        if not np.isfinite(out_frame).all():
            out_frame = np.zeros(N, dtype=np.float32)

        out_frame *= self._window

        # OLA
        self._out_buf[:N] += out_frame
        output = self._out_buf[:H].copy()
        self._out_buf[:-H] = self._out_buf[H:]
        self._out_buf[-H:] = 0.0

        return output / self._ola_gain

    def reset_calibration(self):
        """Force re-calibration (call when switching microphones)."""
        n_bins = self.FFT // 2 + 1
        self._noise_psd   = np.zeros(n_bins, dtype=np.float64)
        self._calib_count = 0
        self._calibrated  = False
        self._prev_mag    = np.zeros(n_bins, dtype=np.float64)
