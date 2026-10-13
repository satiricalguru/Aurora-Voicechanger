"""
Beatrice 2 neural voice-conversion tier (optional).

When the Beatrice runtime + speaker models are installed, character voices use
true neural VC (~40–80 ms class). Until then, try_load_persona() returns None
and the engine falls back to DSP personas in effects.ai_voice.

Install (Apple Silicon recommended):
  See docs in native/ and https://project-beatrice-v2.github.io/Beatrice-website/

Env:
  AURORA_BEATRICE=1          — enable probe
  AURORA_BEATRICE_MODEL_DIR  — path to speaker models
"""
from __future__ import annotations

import os
from typing import Optional

import numpy as np

from .base import BaseEffect

_CACHE: dict[str, object] = {}
_AVAILABLE: bool | None = None


def neural_available() -> bool:
    """True when Beatrice bindings can be imported and models dir exists."""
    global _AVAILABLE
    if _AVAILABLE is not None:
        return _AVAILABLE
    if os.environ.get('AURORA_BEATRICE', '').lower() in ('0', 'false', 'no'):
        _AVAILABLE = False
        return False
    model_dir = os.environ.get('AURORA_BEATRICE_MODEL_DIR', '')
    try:
        import importlib
        mod = importlib.import_module('beatrice')  # optional third-party package
        _AVAILABLE = hasattr(mod, 'VoiceConverter') or hasattr(mod, 'convert')
        if model_dir and not os.path.isdir(model_dir):
            _AVAILABLE = False
    except Exception:
        _AVAILABLE = False
    return _AVAILABLE


def try_load_persona(persona_id: str) -> Optional['BeatricePersona']:
    if not neural_available():
        return None
    if persona_id in _CACHE:
        return _CACHE[persona_id]  # type: ignore[return-value]
    try:
        persona = BeatricePersona(persona_id)
        _CACHE[persona_id] = persona
        return persona
    except Exception as e:
        print(f"[beatrice] Failed to load '{persona_id}': {e}")
        return None


class BeatricePersona(BaseEffect):
    """
    Thin wrapper around a Beatrice VoiceConverter.
    Keeps the same apply(chunk) contract as AIVoicePersona.
    """

    def __init__(self, persona_id: str):
        import beatrice  # type: ignore
        from voices.ai_personas import AI_PERSONAS

        meta = AI_PERSONAS.get(persona_id, {})
        model_dir = os.environ.get('AURORA_BEATRICE_MODEL_DIR', '')
        speaker = os.path.join(model_dir, f'{persona_id}.bin') if model_dir else persona_id

        if hasattr(beatrice, 'VoiceConverter'):
            self._vc = beatrice.VoiceConverter(speaker)
        else:
            raise RuntimeError('beatrice.VoiceConverter not found')

        self.persona_id = persona_id
        self.name = meta.get('name', persona_id)
        self._target_f0 = float(meta.get('target_f0_mean', 200))

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        x = np.asarray(chunk, dtype=np.float32).ravel()
        try:
            y = self._vc.convert(x, sample_rate=48000)
            y = np.asarray(y, dtype=np.float32).ravel()
            if len(y) != len(x):
                # Resample / pad to block size for the RT callback.
                if len(y) > len(x):
                    y = y[:len(x)]
                else:
                    pad = np.zeros(len(x), dtype=np.float32)
                    pad[:len(y)] = y
                    y = pad
            return np.nan_to_num(y, nan=0.0, posinf=1.0, neginf=-1.0)
        except Exception as e:
            print(f"[beatrice] convert error: {e}")
            return np.zeros_like(x)
