// Portraits for every voice: src/assets/avatars/<voice id>.svg, drawn by
// tools/avatars (vector, no image generation). Regenerate with
// `node tools/avatars/generate.mjs`.
const files = import.meta.glob('../assets/avatars/*.svg', { eager: true, query: '?url', import: 'default' });

const byId = {};
for (const [path, url] of Object.entries(files)) {
  byId[path.split('/').pop().replace('.svg', '')] = url;
}

export const faceFor = (id) => byId[id] || null;
