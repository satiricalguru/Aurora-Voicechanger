// Renders every voice portrait to src/assets/avatars/<id>.svg and writes a
// review gallery (tools/avatars/gallery.html, open it through `npx vite`).
//   node tools/avatars/generate.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mix, render } from './kit.mjs';
import { VOICES } from './voices.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(root, 'src', 'assets', 'avatars');
mkdirSync(out, { recursive: true });

// Voice names and colours come from the Python voice definitions.
const meta = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, 'python')
from voices.presets import VOICE_PRESETS
from voices.ai_personas import AI_PERSONAS
from voices.neural import NEURAL_VOICES
out = {}
for src in (VOICE_PRESETS, AI_PERSONAS, NEURAL_VOICES):
    for k, v in src.items():
        out[k] = {'name': v['name'], 'color': v.get('color', '#666680')}
print(json.dumps(out))
`], { cwd: root }).toString());

const missing = Object.keys(meta).filter((k) => !VOICES[k]);
if (missing.length) console.warn('No portrait spec for:', missing.join(', '));

const cards = [];
for (const [vid, spec] of Object.entries(VOICES)) {
  const m = meta[vid] || { name: vid, color: '#666680' };
  // Voice colours are UI accents; tone them down to sit behind a face.
  const bg = spec.bg || mix(m.color, '#1c1b2e', 0.35);
  writeFileSync(join(out, `${vid}.svg`), render({ ...spec, bg }));
  cards.push(`<figure><img src="/src/assets/avatars/${vid}.svg" alt=""><figcaption>${m.name}<small>${vid}</small></figcaption></figure>`);
}

writeFileSync(join(here, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>Avatar gallery</title>
<style>body{margin:0;padding:24px;background:#0c0c12;color:#ddd;font:13px system-ui}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:18px}
figure{margin:0;text-align:center}img{width:112px;height:112px;border-radius:50%;display:block;margin:0 auto 8px;box-shadow:0 8px 24px #0008}
figcaption small{display:block;color:#777;font-size:11px}</style><main>${cards.join('')}</main>`);
console.log(`wrote ${cards.length} portraits to ${out}`);
