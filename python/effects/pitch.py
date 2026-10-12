"""
Phase Vocoder — Pitch Shift + Formant Shift
Phase-vocoder pitch shift with formant correction, plus autotune.

Key fixes vs v1:
  - LPC uses FFT-based autocorrelation (fast, O(N log N) vs O(N²))
  - NaN/Inf guards at every division
  - Levinson-Durbin clamps reflection coefficients to [-0.999, 0.999]
    preventing unstable filter → NaN in spectral_envelope
  - Formant shift skipped when formant≈1.0 (saves compute on most presets)
  - phase vocoder result NaN-cleaned before OLA
"""
import numpy as np
from scipy.signal import lfilter
from .base import BaseEffect

_LPC_ORDER = 16


# ── LPC helpers ──────────────────────────────────────────────────────────────

def _lpc(frame: np.ndarray, order: int = _LPC_ORDER) -> np.ndarray:
    """
    LPC via FFT autocorrelation + Levinson-Durbin.
    Returns coefficients a[0..order] with a[0]=1.
    Reflection coefficients are clamped → filter always stable → no NaN.
    """
    n = len(frame)
    fft_size = 1 << (2 * n - 1).bit_length()          # next power-of-2 ≥ 2n
    F = np.fft.rfft(frame.astype(np.float64), n=fft_size)
    R_full = np.fft.irfft(F * np.conj(F))
    R = R_full[:order + 1].real

    r0 = R[0]
    if r0 < 1e-10:
        a = np.zeros(order + 1)
        a[0] = 1.0
        return a

    # Levinson-Durbin
    a = np.zeros(order + 1)
    a[0] = 1.0
    e = r0

    for i in range(1, order + 1):
        if e < 1e-12:
            break
        lam = -np.dot(a[:i][::-1], R[1:i + 1]) / e
        # Clamp: |lam| < 1 ensures stable AR filter (no poles on/outside unit circle)
        lam = float(np.clip(lam, -0.999, 0.999))
        a_new = a.copy()
        for j in range(1, i):
            a_new[j] = a[j] + lam * a[i - j]
        a_new[i] = lam
        a = a_new
        e *= (1.0 - lam * lam)

    return a


def _spectral_envelope(frame: np.ndarray, fft_size: int, order: int = _LPC_ORDER) -> np.ndarray:
    """LPC spectral envelope — safe against NaN/Inf."""
    a = _lpc(frame, order)
    impulse = np.zeros(fft_size)
    impulse[0] = 1.0
    ir = lfilter([1.0], a, impulse)
    env = np.abs(np.fft.rfft(ir, n=fft_size))
    # Floor prevents division by zero in formant warp
    env = np.where(np.isfinite(env) & (env > 1e-9), env, 1e-9)
    return env


# ── Phase Vocoder ─────────────────────────────────────────────────────────────

class PitchEffect(BaseEffect):
    """
    Phase vocoder with independent formant shifting.
    semitones : pitch shift amount (-24 to +24)
    formant   : formant multiplier (0.5–2.0; 1.0 = no change)
    """

    FFT = 1024  # Reduced from 2048 for better realtime performance
    HOP = 256   # Reduced from 512, 75% overlap

    def __init__(self, semitones: float = 0.0, formant: float = 1.0):
        self.semitones = float(semitones)
        self.formant   = float(formant)
        self._init_buffers()

    def _init_buffers(self):
        N, H = self.FFT, self.HOP
        # Use sqrt(Hanning) window for better overlap-add reconstruction
        self._window     = np.sqrt(np.hanning(N)).astype(np.float32)
        self._in_buf     = np.zeros(N, dtype=np.float32)
        self._out_buf    = np.zeros(N + H, dtype=np.float32)  # Overlap buffer
        n_bins           = N // 2 + 1
        self._prev_phase = np.zeros(n_bins, dtype=np.float64)
        self._synth_phase= np.zeros(n_bins, dtype=np.float64)
        self._omega      = 2.0 * np.pi * np.arange(n_bins) * H / N
        # Better OLA gain calculation for sqrt(hanning)
        self._ola_gain   = float(np.sum(self._window ** 2) / H) or 1.0

    def set_param(self, key, value):
        super().set_param(key, value)

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        H, N = self.HOP, self.FFT

        # Shift input ring buffer
        self._in_buf[:-H] = self._in_buf[H:]
        self._in_buf[-H:] = chunk[:H]

        frame = self._in_buf * self._window

        # Skip all processing when no pitch or formant shift needed
        if abs(self.semitones) < 0.05 and abs(self.formant - 1.0) < 0.05:
            self._out_buf[:N] += frame
            output = self._out_buf[:H].copy()
            self._out_buf[:-H] = self._out_buf[H:]
            self._out_buf[-H:] = 0.0
            return output / self._ola_gain

        ratio = 2.0 ** (self.semitones / 12.0)
        spec  = np.fft.rfft(frame, n=N)
        mag   = np.abs(spec)
        phase = np.angle(spec)
        n_bins = N // 2 + 1
        bins   = np.arange(n_bins)

        # Guard: NaN in mag → silence this frame
        if not np.isfinite(mag).all():
            mag = np.zeros(n_bins)

        # ── Formant shift ────────────────────────────────────────────
        if abs(self.formant - 1.0) > 0.05:
            envelope = _spectral_envelope(frame, N, order=_LPC_ORDER)
            form_bins = bins / self.formant
            form_idx  = np.clip(form_bins.astype(int), 0, n_bins - 1)
            form_hi   = np.clip(form_idx + 1, 0, n_bins - 1)
            frac      = form_bins - form_idx
            new_env   = envelope[form_idx] * (1 - frac) + envelope[form_hi] * frac
            # Safe division
            ratio_env = np.where(envelope > 1e-9, new_env / envelope, 1.0)
            ratio_env = np.clip(ratio_env, 0.0, 10.0)
            mag = mag * ratio_env

        # ── Phase vocoder ────────────────────────────────────────────
        delta = phase - self._prev_phase - self._omega
        delta = np.angle(np.exp(1j * delta))  # Better phase unwrapping
        inst_freq = self._omega + delta
        self._prev_phase = phase.copy()

        # Bin remapping with better interpolation
        pitch_bins = bins / ratio
        pbin_int   = np.clip(pitch_bins.astype(int), 0, n_bins - 2)  # -2 to allow interpolation
        pbin_frac  = pitch_bins - pbin_int

        # Cubic interpolation for smoother bin mapping (vectorized)
        idx0 = np.clip(pbin_int - 1, 0, n_bins - 1)
        idx1 = pbin_int
        idx2 = np.clip(pbin_int + 1, 0, n_bins - 1)
        idx3 = np.clip(pbin_int + 2, 0, n_bins - 1)

        p0 = mag[idx0]
        p1 = mag[idx1]
        p2 = mag[idx2]
        p3 = mag[idx3]

        a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3
        b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3
        c = -0.5 * p0 + 0.5 * p2
        d = p1

        new_mag_cubic = ((a * pbin_frac + b) * pbin_frac + c) * pbin_frac + d
        # FIX #8: zero bins that map beyond the output spectrum instead of
        # clamping them all to the last bin (which caused a metallic spike).
        out_of_range = (pitch_bins >= n_bins - 1)
        new_mag = np.where(out_of_range, 0.0, np.where(pbin_int < n_bins - 3, new_mag_cubic, mag[pbin_int]))

        freq_shift = inst_freq[pbin_int] * ratio
        self._synth_phase += freq_shift
        self._synth_phase %= (2.0 * np.pi)
        
        # Zero out phase for DC and Nyquist to prevent massive DC oscillation
        self._synth_phase[0] = 0.0
        self._synth_phase[-1] = 0.0

        new_spec  = new_mag * np.exp(1j * self._synth_phase)
        
        # Ensure DC and Nyquist are perfectly real
        new_spec[0] = mag[0] if ratio == 1.0 else new_mag[0]
        new_spec[-1] = mag[-1] if ratio == 1.0 else new_mag[-1]

        # Reconstruct
        out_frame = np.fft.irfft(new_spec, n=N)

        # NaN guard on reconstructed frame
        if not np.isfinite(out_frame).all():
            out_frame = np.zeros(N)

        out_frame = (out_frame.real.astype(np.float32) * self._window)

        # Overlap-add
        self._out_buf[:N] += out_frame
        output = self._out_buf[:H].copy()
        self._out_buf[:-H] = self._out_buf[H:]
        self._out_buf[-H:]  = 0.0

        return output / self._ola_gain


# ── Autotune ──────────────────────────────────────────────────────────────────

class AutotuneEffect(BaseEffect):
    SCALES = {
        'C_major':   [0, 2, 4, 5, 7, 9, 11],
        'A_minor':   [0, 2, 3, 5, 7, 8, 10],
        'C':         [0, 2, 4, 5, 7, 9, 11],
        'chromatic': list(range(12)),
    }

    def __init__(self, key: str = 'C_major', speed: float = 0.05):
        self.key   = key
        self.speed = speed
        self._pitch_fx = PitchEffect(semitones=0.0, formant=1.0)
        self._current_shift = 0.0
        try:
            from f0.yin import YINDetector
            self._yin = YINDetector()
        except Exception:
            self._yin = None

    def _nearest_scale_semitone(self, f0_hz: float) -> float:
        if f0_hz <= 0:
            return 0.0
        midi = 69.0 + 12.0 * np.log2(f0_hz / 440.0)
        pc = midi % 12.0
        scale = self.SCALES.get(self.key, self.SCALES['C_major'])
        diffs = [(s - pc + 6) % 12 - 6 for s in scale]
        return float(min(diffs, key=abs))

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        f0 = self._yin.detect(chunk) if self._yin else 0.0
        target = self._nearest_scale_semitone(f0)
        self._current_shift += self.speed * (target - self._current_shift)
        self._pitch_fx.semitones = self._current_shift
        return self._pitch_fx.apply(chunk)
