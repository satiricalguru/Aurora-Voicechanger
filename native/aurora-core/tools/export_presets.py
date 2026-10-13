"""Write every voice (DSP presets + character personas) as `id<TAB>chain-json`
lines, the format aurora_bench and the native engine consume."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'python'))
from voices.presets import VOICE_PRESETS  # noqa: E402
from voices.ai_personas import AI_PERSONAS  # noqa: E402


def persona_config(p: dict) -> dict:
    keys = ('target_f0_mean', 'resonance_shift', 'breathiness', 'roughness',
            'brightness', 'vibrato_rate', 'vibrato_depth')
    return {'persona': {k: p[k] for k in keys if k in p}, 'chain': p.get('pitch_chain', [])}


def main(out_path: str):
    with open(out_path, 'w') as f:
        for k, v in VOICE_PRESETS.items():
            f.write(f"{k}\t{json.dumps({'chain': v['chain']})}\n")
        for k, v in AI_PERSONAS.items():
            f.write(f"{k}\t{json.dumps(persona_config(v))}\n")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'presets.jsonl')
