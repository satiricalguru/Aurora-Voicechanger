"""
Neural voices: a streaming voice-conversion model, optionally followed by a
DSP chain to shape it into a character. Native engine only.

`model` is relative to the models directory (repo `models/`, or AURORA_MODELS).
Export models with native/aurora-core/tools/llvc/export_llvc.py.
"""

NEURAL_VOICES = {
    "lyra": {
        "name": "Lyra", "tag": "AI", "color": "#8b7bff",
        "description": "Real-time AI voice conversion (LLVC, ~30 ms)",
        "model": "llvc/llvc.onnx",
        "post_chain": [],
    },
    "lyra_bright": {
        "name": "Lyra Bright", "tag": "AI", "color": "#ff8bd8",
        "description": "Lyra, lifted and airy",
        "model": "llvc/llvc.onnx",
        "post_chain": [
            {"effect": "pitch", "semitones": 3, "formant": 1.08},
            {"effect": "eq", "low": -2, "mid": 0, "high": 2},
        ],
    },
    "lyra_low": {
        "name": "Lyra Low", "tag": "AI", "color": "#5a6bff",
        "description": "Lyra, darker and lower",
        "model": "llvc/llvc.onnx",
        "post_chain": [
            {"effect": "pitch", "semitones": -4, "formant": 0.9},
            {"effect": "eq", "low": 2, "mid": -1, "high": -1},
        ],
    },
}
