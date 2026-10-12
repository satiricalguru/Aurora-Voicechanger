"""Write src/lib/voices.json from the Python presets so the UI can show the
voice list before the engine connects. Run after editing python/voices/*."""
import json, os, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(root, 'python'))
from voices.presets import VOICE_PRESETS
from voices.ai_personas import AI_PERSONAS

data = {
    'dsp': [{'id': k, 'name': v['name'], 'category': v['category'], 'color': v.get('color', '#666680'), 'type': 'dsp'}
            for k, v in VOICE_PRESETS.items()],
    'ai': [{'id': k, 'name': v['name'], 'category': v['category'], 'tag': v.get('tag', ''), 'color': v.get('color', '#666680'),
            'description': v.get('description', ''), 'type': 'ai'} for k, v in AI_PERSONAS.items()],
}
with open(os.path.join(root, 'src', 'lib', 'voices.json'), 'w') as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print(len(data['dsp']), 'effects,', len(data['ai']), 'characters')
