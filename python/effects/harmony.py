"""
Harmony / Octaver Effect
Generates pitch-shifted copies of input and mixes them for harmony, doubling, octaving.
Uses the same phase vocoder as pitch.py for quality results.
"""
import numpy as np
from .base import BaseEffect


class HarmonyEffect(BaseEffect):
    """
    Generate N pitch-shifted harmony voices and mix with original.
    intervals:     list of semitone intervals (e.g. [4, 7] for major chord)
    detune_cents:  slight detune per voice for "doubling" effect
    wet:           harmony mix level
    """

    def __init__(self,
                 intervals: list | None = None,
                 detune_cents: float = 0.0,
                 wet: float = 0.4):
        if intervals is None:
            intervals = [4, 7]
        self.intervals = intervals
        self.detune_cents = detune_cents
        self.wet = wet
        self._build_voices()

    def _build_voices(self):
        from .pitch import PitchEffect
        self._voices = []
        for semitones in self.intervals:
            total = semitones + self.detune_cents / 100.0
            self._voices.append(PitchEffect(semitones=total, formant=1.0))

    def set_param(self, key, value):
        super().set_param(key, value)
        self._build_voices()

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        if not self._voices:
            return chunk
        harmony_sum = np.zeros(len(chunk), dtype=np.float32)
        for voice in self._voices:
            harmony_sum += voice.apply(chunk)
        harmony_sum /= len(self._voices)
        return chunk * (1.0 - self.wet) + harmony_sum * self.wet
