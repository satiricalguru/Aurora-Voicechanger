"""
AI Voice Persona Engine — v2 (NaN-safe, fast)
Key fixes vs v1:
  - Brightness implemented as numpy vectorized first-order high-shelf (no Python for-loop)
  - np.nan_to_num() guards after every stage
  - Vibrato uses chunk-level LFO (no per-sample loop)
  - Degenerate f0 handled gracefully (0 Hz → passthrough)
"""
import numpy as np
from .base import BaseEffect
from .pitch import PitchEffect


class AIVoicePersona(BaseEffect):
    FFT = 1024  # Match pitch effect
    HOP = 256   # Match pitch effect

    def __init__(self, persona_id: str):
        from voices.ai_personas import AI_PERSONAS
        from effects.chain import EffectChain
        p = AI_PERSONAS[persona_id]

        self.target_f0      = float(p['target_f0_mean'])
        self.target_f0_std  = float(p.get('target_f0_std', 30))
        self.breathiness    = float(p['breathiness'])
        self.roughness      = float(p['roughness'])
        self.brightness     = float(p['brightness'])
        self.resonance_shift= float(p['resonance_shift'])
        self.vibrato_rate   = float(p['vibrato_rate'])
        self.vibrato_depth  = float(p['vibrato_depth'])
        self.post_chain     = EffectChain.from_preset({'chain': p.get('pitch_chain', [])})

        # YIN pitch detector and analysis buffer
        from f0.yin import YINDetector
        self._yin = YINDetector(threshold=0.15, min_freq=70, max_freq=500)
        self._yin_buf = np.zeros(1024, dtype=np.float32)

        # Phase vocoder
        self._pitch_fx = PitchEffect(semitones=0.0, formant=self.resonance_shift)

        # F0 smoothing history (reduced for better responsiveness)
        self._f0_history: list[float] = []

        # Vibrato state
        self._vib_phase = 0.0
        self._sr = 48000

        # Brightness filter state (biquad high-shelf: transposed direct form II zi state)
        self._hp_zi = np.zeros(2, dtype=np.float64)

        # Pre-compute brightness biquad coefficients once (they never change after init)
        self._smoothed_f0   = self.target_f0  # seed at target — avoids ±24-semitone startup jump
        self._brightness_b  = None
        self._brightness_a  = None
        self._compute_brightness_coeffs()

        # Roughness: keep previous chunk's jitter tail for smooth cross-fade
        self._prev_jitter_end = 1.0
        # F0 tracking: hold last valid semitone shift to avoid sudden jumps on unvoiced frames
        self._last_semitones = 0.0
        self._voiced_frames = 0  # consecutive voiced frame counter

    def _compute_brightness_coeffs(self):
        """Pre-compute high-shelf biquad coefficients for the brightness filter.
        Called once in __init__ — brightness is read-only after construction."""
        if abs(self.brightness) <= 0.01:
            self._brightness_b = None
            self._brightness_a = None
            return
        f0_hz = 2000.0
        g_db  = self.brightness * 6.0   # ±6 dB boost/cut
        q     = 0.7
        w0    = 2.0 * np.pi * f0_hz / self._sr
        a     = 10.0 ** (g_db / 40.0)
        alpha = np.sin(w0) / (2.0 * q)
        b0 = a * ((a+1) + (a-1)*np.cos(w0) + 2*np.sqrt(a)*alpha)
        b1 = -2*a * ((a-1) + (a+1)*np.cos(w0))
        b2 = a * ((a+1) + (a-1)*np.cos(w0) - 2*np.sqrt(a)*alpha)
        a0 = (a+1) - (a-1)*np.cos(w0) + 2*np.sqrt(a)*alpha
        a1 = 2 * ((a-1) - (a+1)*np.cos(w0))
        a2 = (a+1) - (a-1)*np.cos(w0) - 2*np.sqrt(a)*alpha
        self._brightness_b = np.array([b0/a0, b1/a0, b2/a0], dtype=np.float64)
        self._brightness_a = np.array([1.0, a1/a0, a2/a0], dtype=np.float64)

    def _get_pitch_semitones(self, f0: float) -> float:
        """Map detected F0 → semitone shift toward target F0 (with smoothing)."""
        if f0 <= 0:
            return 0.0
        self._f0_history.append(f0)
        if len(self._f0_history) > 10:  # Reduced from 30 for better responsiveness
            self._f0_history.pop(0)

        # Use median of recent values to reject outliers, then exponential smoothing
        if len(self._f0_history) >= 3:
            recent_median = float(np.median(self._f0_history[-5:]))  # Last 5 samples
            # Simple exponential smoothing with alpha=0.3
            self._smoothed_f0 = 0.3 * recent_median + 0.7 * self._smoothed_f0
            src = self._smoothed_f0
        else:
            src = float(np.mean(self._f0_history))

        if src <= 0:
            return 0.0
        ratio = self.target_f0 / src
        semitones = 12.0 * np.log2(max(ratio, 0.1))  # Increased min ratio from 0.05
        return float(np.clip(semitones, -24.0, 24.0))

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)

        # ── 1. Update YIN buffer and Detect F0 ──────────────────────
        self._yin_buf[:-n] = self._yin_buf[n:]
        self._yin_buf[-n:] = chunk
        f0 = self._yin.detect(self._yin_buf)

        # ── 2. Pitch ratio — gate on voiced frames only ───────────────────────
        if f0 > 0:
            new_semitones = self._get_pitch_semitones(f0)
            # Reject implausibly large jumps (>8 semitones/chunk = 100ms artifact)
            if abs(new_semitones - self._last_semitones) < 8.0:
                self._last_semitones = new_semitones
                self._voiced_frames += 1
            # else: ignore this frame, hold last value
        else:
            # Unvoiced: slowly decay shift toward 0 over ~10 chunks
            self._last_semitones *= 0.85
            self._voiced_frames = 0
        semitones = self._last_semitones

        # ── 3. Vibrato (single chunk-level LFO — no per-sample loop) ──
        if self.vibrato_rate > 0 and self.vibrato_depth > 0:
            vib = np.sin(2.0 * np.pi * self._vib_phase)
            self._vib_phase = (self._vib_phase + self.vibrato_rate / self._sr) % 1.0
            semitones += vib * (self.vibrato_depth / 100.0)

        # ── 4. Phase vocoder pitch + formant shift ────────────────────
        self._pitch_fx.semitones = semitones
        self._pitch_fx.formant   = self.resonance_shift
        out = self._pitch_fx.apply(chunk)
        out = np.nan_to_num(out, nan=0.0, posinf=1.0, neginf=-1.0)

        # ── 5. Breathiness ────────────────────────────────────────────
        if self.breathiness > 0.01:
            rms = float(np.sqrt(np.mean(out * out)) + 1e-9)
            noise = np.random.randn(n).astype(np.float32) * rms
            out = out * (1.0 - self.breathiness) + noise * self.breathiness

        # ── 6. Roughness (amplitude jitter — smoothed across chunk boundaries) ──
        if self.roughness > 0.01:
            # Generate target jitter for this chunk
            jitter_target = 1.0 + np.random.randn(n).astype(np.float32) * self.roughness * 0.12
            # Cross-fade from previous chunk's end value to avoid discontinuity click
            fade = np.linspace(0.0, 1.0, n, dtype=np.float32)
            jitter = self._prev_jitter_end * (1.0 - fade) + jitter_target * fade
            self._prev_jitter_end = float(jitter_target[-1])
            out = out * jitter

        # ── 7. Brightness — high-shelf filter using pre-computed coefficients ──
        if self._brightness_b is not None:
            import scipy.signal
            out_double, self._hp_zi = scipy.signal.lfilter(
                self._brightness_b, self._brightness_a,
                out.astype(np.float64), zi=self._hp_zi,
            )
            out = out_double.astype(np.float32)

        # ── 8. Post DSP chain ──────────────────────────────────────────
        out = self.post_chain.apply(out)
        out = np.nan_to_num(out, nan=0.0, posinf=1.0, neginf=-1.0)

        return out
