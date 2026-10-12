// Portraits for character voices: src/assets/faces/<voice id>.jpg
const files = import.meta.glob('../assets/faces/*.jpg', { eager: true, query: '?url', import: 'default' });

const byId = {};
for (const [path, url] of Object.entries(files)) {
  byId[path.split('/').pop().replace('.jpg', '')] = url;
}

export const faceFor = (id) => byId[id] || null;
