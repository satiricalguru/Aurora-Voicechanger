"""
Effect Chain Composer
Composes a sequence of DSP effects from preset definitions.
Each voice is an ordered chain of DSP effects.
"""
import numpy as np
from .base import BaseEffect


def _build_effect_map():
    """Lazy-loaded effect map to avoid circular imports."""
    from . import pitch, robot, reverb, chorus, distortion, eq, noise_gate, harmony

    return {
        'pitch':         pitch.PitchEffect,
        'robot':         robot.RobotEffect,
        'reverb':        reverb.ReverbEffect,
        'chorus':        chorus.ChorusEffect,
        'vibrato':       chorus.VibratoEffect,
        'delay':         chorus.DelayEffect,
        'wah':           chorus.WahEffect,
        'distortion':    distortion.DistortionEffect,
        'whisper':       distortion.WhisperEffect,
        'eq':            eq.EQEffect,
        'noise_inject':  noise_gate.NoiseInjectEffect,
        'harmony':       harmony.HarmonyEffect,
        'autotune':      pitch.AutotuneEffect,
    }


class EffectChain:
    """Ordered chain of DSP effects applied sequentially to each audio chunk."""

    def __init__(self, effects: list[BaseEffect]):
        self.effects = effects

    @classmethod
    def from_preset(cls, preset: dict) -> 'EffectChain':
        """
        Instantiate an EffectChain from a preset dict.
        preset format: {'chain': [{'effect': 'pitch', 'semitones': 5, ...}, ...]}
        """
        effect_map = _build_effect_map()
        effects = []
        for stage in preset.get('chain', []):
            stage = dict(stage)  # copy to avoid mutation
            effect_name = stage.pop('effect')
            cls_ = effect_map.get(effect_name)
            if cls_ is None:
                continue  # unknown effect — skip gracefully
            try:
                # Map preset keys to constructor params
                # Handle renamed keys
                if 'room' in stage:
                    stage['room'] = stage.pop('room')
                if 'rate' in stage and effect_name in ('chorus', 'vibrato', 'wah'):
                    stage['rate'] = stage.pop('rate')
                effects.append(cls_(**stage))
            except Exception as e:
                print(f"[chain] Failed to create {effect_name}: {e}")
        return cls(effects)

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        """Apply all effects in sequence."""
        for fx in self.effects:
            try:
                chunk = fx.apply(chunk)
            except Exception as e:
                print(f"[chain] Effect error: {e}")
        return chunk

    def set_param(self, effect_name: str, param: str, value):
        """Set a parameter on the first matching effect in the chain."""
        for fx in self.effects:
            if fx.__class__.__name__.lower().startswith(effect_name.lower()):
                fx.set_param(param, value)
                return
