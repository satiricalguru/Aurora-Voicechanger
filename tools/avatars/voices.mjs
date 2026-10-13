// Art direction per voice. Keys are voice ids (python/voices/*.py).
// See kit.mjs for the part vocabulary.

const H = (style, color, fringe) => ({ style, color, ...(fringe ? { fringe } : {}) });
const T = (style, color, extra = {}) => ({ style, color, ...extra });

export const VOICES = {
  // ── Neural (AI) ──────────────────────────────────────────────────────────────
  lyra: { skin: 'light', hair: H('wavy', '#2d1d3a', 'side'), eyes: { style: 'round', color: '#6b4fd8', lash: true }, brows: 'soft', mouth: 'lips', lip: '#c2566e', clothes: T('turtleneck', '#e9e6f5'), acc: [{ type: 'earrings', color: '#9fe7ff' }], bgPattern: 'dots' },
  lyra_bright: { skin: 'fair', hair: H('wavy', '#e8b9d8', 'side'), eyes: { style: 'round', color: '#d0569a', lash: true }, brows: 'raised', mouth: 'smile', lip: '#d4577a', blush: true, clothes: T('turtleneck', '#ffffff'), acc: [{ type: 'sparkles', color: '#ffffff' }], bgPattern: 'stars' },
  lyra_low: { skin: 'medium', hair: H('wavy', '#141428', 'side'), eyes: { style: 'sleepy', color: '#3a6bd8' }, brows: 'flat', mouth: 'lips', lip: '#8e3a52', clothes: T('turtleneck', '#262a44'), acc: [{ type: 'hoops', color: '#c9d4ff' }] },

  // ── Anime characters ─────────────────────────────────────────────────────────
  akatsume: { skin: 'pale', head: { jaw: 0.42, chin: 60 }, hair: H('long', '#5a0f2a', 'strands'), eyes: { style: 'anime', color: '#ff2a3d' }, brows: 'angry', mouth: 'fangs', clothes: T('armor', '#2a0f1f'), acc: [{ type: 'horns', color: '#1a0a12' }], bgPattern: 'flames' },
  genki: { skin: 'fair', head: { jaw: 0.42, chin: 60 }, hair: H('spiky', '#3fa7ff'), eyes: { style: 'happy' }, brows: 'raised', mouth: 'open', blush: true, clothes: T('tee', '#ffd23f', { trim: '#ff8f1f' }), acc: [{ type: 'starClip', color: '#ffe066', side: -1 }], bgPattern: 'rays' },
  kawaii: { skin: 'porcelain', head: { jaw: 0.42, chin: 60 }, hair: H('bob', '#ff9cc6'), eyes: { style: 'anime', color: '#c25bd6' }, brows: 'soft', mouth: 'cat', blush: true, clothes: T('idol', '#ffe1ef', { trim: '#ff6fae' }), acc: [{ type: 'catEars', color: '#ff9cc6', inner: '#ffe0ec' }, { type: 'ribbon', color: '#ff4f8b', side: 1 }], bgPattern: 'dots' },
  yoen: { skin: 'pale', head: { jaw: 0.42, chin: 60 }, hair: H('hime', '#2a1648'), eyes: { style: 'sleepy', color: '#8f5bff' }, brows: 'flat', mouth: 'neutral', clothes: T('turtleneck', '#1a1430') },
  lovely: { skin: 'porcelain', head: { jaw: 0.42, chin: 60 }, hair: H('twintails', '#ffb3d9', 'strands'), eyes: { style: 'anime', color: '#ff5fa8' }, brows: 'soft', mouth: 'open', blush: true, clothes: T('idol', '#ffffff', { trim: '#ff8fc6' }), acc: [{ type: 'tiara', color: '#ffd75e', gem: '#ff4fa3' }, { type: 'sparkles', color: '#ffffff' }], bgPattern: 'stars' },
  akari: { skin: 'fair', head: { jaw: 0.42, chin: 60 }, hair: H('long', '#b9b6ff', 'strands'), eyes: { style: 'anime', color: '#36c6ff' }, brows: 'soft', mouth: 'smile', blush: true, clothes: T('hoodie', '#2a2f52'), acc: [{ type: 'headphones', color: '#f4f6ff', accent: '#36c6ff', mic: true }], bgPattern: 'grid' },
  kidol: { skin: 'fair', head: { jaw: 0.45, chin: 58 }, hair: H('long', '#f3e1c4', 'curtain'), eyes: { style: 'round', color: '#5a3a2a', lash: true }, brows: 'soft', mouth: 'lips', lip: '#e0566e', blush: '#ff9aa8', clothes: T('jacket', '#14c7a6', { shirt: '#ffffff' }), acc: [{ type: 'hoops', color: '#e9e9ef' }], bgPattern: 'rays' },
  cartoon_girl: { skin: 'light', head: { jaw: 0.5, chin: 56 }, hair: H('buns', '#ff8a2b', 'blunt'), eyes: { style: 'anime', color: '#3fae4d' }, brows: 'raised', mouth: 'open', blush: true, clothes: T('tee', '#3a7bff'), acc: ['freckles'], bgPattern: 'dots' },

  // ── Realistic characters ─────────────────────────────────────────────────────
  corinne: { skin: 'tan', hair: H('bob', '#2b1a12', 'parted'), eyes: { style: 'round', color: '#5a3a22' }, brows: 'soft', mouth: 'smile', lip: '#a0454f', clothes: T('suit', '#c8a882', { shirt: '#f6f1ea', tie: false }), acc: [{ type: 'earrings', color: '#f2d27a' }] },
  jennifer: { skin: 'light', hair: H('ponytail', '#a9562a', 'swept'), eyes: { style: 'round', color: '#3f6b3a' }, brows: 'soft', mouth: 'grin', clothes: T('tee', '#ff8844'), acc: ['freckles'] },
  vicky: { skin: 'fair', hair: H('wavy', '#8f1d24', 'side'), eyes: { style: 'round', color: '#2e5b44', lash: true }, brows: 'raised', mouth: 'lips', lip: '#c4192f', clothes: T('dress', '#2a0d12', { trim: '#7a1520' }), acc: [{ type: 'earrings', color: '#ffd36b', r: 4 }] },
  haley: { skin: 'brown', hair: H('curly', '#2a1710', 'curly'), eyes: { style: 'round', color: '#3a2214' }, brows: 'raised', mouth: 'grin', blush: '#d9686f', clothes: T('tee', '#ff6699', { trim: '#d94677' }), acc: [{ type: 'hoops', color: '#ffd36b' }] },
  claudia: { skin: 'light', hair: H('bob', '#b8b0c8', 'parted'), eyes: { style: 'round', color: '#5a4a7a', lash: true }, brows: 'soft', mouth: 'lips', lip: '#8e3a52', clothes: T('turtleneck', '#3b3250'), acc: [{ type: 'earrings', color: '#f0e9ff' }, { type: 'glasses', color: '#2b2238', round: true }] },
  blake: { skin: 'fair', hair: H('bob', '#1a1a22', 'swept'), eyes: { style: 'round', color: '#7a4ae0', lash: true }, brows: 'flat', mouth: 'smirk', lip: '#6a2a5a', clothes: T('jacket', '#18181e', { shirt: '#cc55ff' }), acc: [{ type: 'hoops', color: '#d8d8e0' }, { type: 'earrings', color: '#cc55ff', r: 2.5 }] },
  alice: { skin: 'deep', hair: H('bun', '#151010', 'parted'), eyes: { style: 'round', color: '#3a2214' }, brows: 'angry', mouth: 'neutral', clothes: T('suit', '#24304a', { shirt: '#eef1f6', tie: '#8a1f2b' }), acc: [{ type: 'glasses', color: '#111', round: false }] },
  agatha: { skin: 'fair', head: { chin: 54, jaw: 0.7 }, hair: H('bun', '#e6e3e8', 'parted'), eyes: { style: 'happy' }, brows: 'soft', browColor: '#b9b2b9', mouth: 'smile', blush: '#ff9a9a', clothes: T('turtleneck', '#b28dbf'), acc: [{ type: 'glasses', color: '#7a5a3a', round: true }, { type: 'earrings', color: '#ffffff', r: 3 }] },

  // ── Dark characters ──────────────────────────────────────────────────────────
  creepy_girl: { skin: 'ghost', head: { jaw: 0.5 }, hair: H('long', '#0b0b10', 'veil'), eyes: { style: 'void', pupil: '#ffffff' }, brows: 'none', mouth: 'neutral', lip: '#4a4a5a', clothes: T('dress', '#d9d9e4', { trim: '#a0a0b0' }), bg: '#3a0a12' },
  runic_sorceress: { skin: 'violet', head: { jaw: 0.45, chin: 58 }, hair: H('long', '#e8e4ff', 'parted'), eyes: { style: 'glow', color: '#c58bff' }, brows: 'flat', browColor: '#d8d0ff', mouth: 'lips', lip: '#5a2a7a', clothes: T('robe', '#2a0f4a', { trim: '#c58bff' }), acc: [{ type: 'runes', color: '#e6c8ff' }, { type: 'thirdEye', color: '#a64bff' }], bgPattern: 'stars' },
  ping: { skin: 'pale', hair: H('long', '#1c2430', 'veil'), eyes: { style: 'glow', color: '#4fd1ff' }, brows: 'none', mouth: 'neutral', clothes: T('hoodie', '#1e2833'), hoodColor: '#24303d' },
  fox: { skin: 'light', head: { jaw: 0.45, chin: 58 }, hair: H('long', '#ff7a1f', 'swept'), eyes: { style: 'anime', color: '#ffb000' }, brows: 'angry', mouth: 'smirk', lip: '#a33a2a', clothes: T('robe', '#7a1f1f', { trim: '#ffcf5b' }), acc: [{ type: 'foxEars', color: '#ff7a1f' }, { type: 'warpaint', color: '#d6262c' }] },
  shiva: { skin: 'tan', hair: H('messy-long', '#2a1a10', 'messy'), eyes: { style: 'angry', color: '#5a3a1a' }, brows: 'angry', mouth: 'neutral', clothes: T('armor', '#6a4a2a'), acc: [{ type: 'warpaint', color: '#8e1a1a' }, 'scar'], bgPattern: 'flames' },
  angry_girl: { skin: 'light', head: { jaw: 0.45 }, hair: H('messy-long', '#c21f1f', 'messy'), eyes: { style: 'angry', color: '#ff2a1f' }, brows: 'angry', mouth: 'shout', clothes: T('jacket', '#1d1d22', { shirt: '#ff2200' }), bgPattern: 'flames' },
  field: { skin: 'medium', hair: H('', '#222'), eyes: { style: 'angry', color: '#4a3a2a' }, brows: 'thick', mouth: 'neutral', clothes: T('tactical', '#41583f'), acc: [{ type: 'helmet', color: '#3e4f3a', goggles: '#ffb347' }, { type: 'gasMask', color: '#2a322a' }], bgPattern: 'grid' },

  // ── Creatures ────────────────────────────────────────────────────────────────
  mother_entity: { special: 'cosmic', skin: 'teal', hair: H('tentacles', '#0c3a35', 'tentacles'), clothes: T('robe', '#06201d', { trim: '#16d4a0' }), bgPattern: 'stars', bg: '#0a2a26' },
  aetherian: { skin: 'metal', head: { jaw: 0.45, chin: 58 }, hair: H('', '#000'), eyes: { style: 'glow', color: '#00ff9d' }, brows: 'none', mouth: 'neutral', lip: '#4a5a66', clothes: T('armor', '#2a3a44'), acc: [{ type: 'visor', color: '#00ff9d', layer: 'head' }, { type: 'runes', color: '#00ff9d' }], bgPattern: 'grid' },
  farty_kawaii: { skin: 'goblin', head: { jaw: 0.5, chin: 54 }, ears: 'pointed', hair: H('buns', '#ff5fa0', 'strands'), eyes: { style: 'anime', color: '#ffcf2b' }, brows: 'raised', mouth: 'sharp', blush: '#ff6f8a', clothes: T('tee', '#7a3fff'), acc: [{ type: 'ribbon', color: '#ff5fa0', side: -1 }] },
  guardian_doll: { skin: 'porcelain', head: { jaw: 0.5, chin: 56 }, hair: H('wavy', '#e8c27a', 'blunt'), eyes: { style: 'anime', color: '#3f7fd8' }, brows: 'soft', mouth: 'lips', lip: '#c94a5a', clothes: T('idol', '#efe2d2', { trim: '#ffffff' }), acc: ['dollCheeks', 'cracks', { type: 'ribbon', color: '#2a3a6a', side: 1 }] },
  the_ringer: { special: 'skull', clothes: T('robe', '#2a1a10', { trim: '#5a3a1a' }), bg: '#3a2410', bgPattern: 'flames' },

  // ── Effects: Sci-Fi ──────────────────────────────────────────────────────────
  robot: { special: 'robot', metal: '#b4bcc8', led: '#00d4ff', clothes: T('metal', '#5a6472'), bgPattern: 'grid' },
  alien: { special: 'alien', skin: '#8fd16a', clothes: T('turtleneck', '#3a5a2a'), bgPattern: 'stars' },
  android: { skin: 'fair', hair: H('short', '#cfd6dd', 'short'), eyes: { style: 'glow', color: '#00ffcc' }, brows: 'flat', browColor: '#9aa4ad', mouth: 'neutral', clothes: T('metal', '#3a4a52'), acc: [{ type: 'runes', color: '#00ffcc' }], bgPattern: 'grid' },
  spacemen: { special: 'astronaut', skin: 'medium', hair: H('short', '#2a1a12', 'short'), eyes: { style: 'round', color: '#3a2a1a' }, brows: 'raised', mouth: 'grin', clothes: T('suit', '#e9edf2', { shirt: '#e9edf2', tie: false }), bgPattern: 'stars' },
  cybertune: { skin: 'light', hair: H('mohawk', '#ff2bd6', 'mohawk'), eyes: { style: 'round', color: '#222' }, brows: 'flat', mouth: 'smirk', clothes: T('jacket', '#1a1030', { shirt: '#ff2bd6' }), acc: [{ type: 'visor', color: '#ff2bd6' }, 'notes'], bgPattern: 'grid' },
  ai_assistant: { skin: '#9fe8ff', hair: H('bob', '#e9fbff', 'parted'), eyes: { style: 'glow', color: '#00ff88' }, brows: 'none', mouth: 'smile', lip: '#3aa88a', clothes: T('turtleneck', '#e9fbff'), acc: [{ type: 'runes', color: '#00c47a' }], bgPattern: 'dots' },

  // ── Effects: Gender / age ────────────────────────────────────────────────────
  man_to_woman: { skin: 'light', hair: H('long', '#6a3a22', 'side'), eyes: { style: 'round', color: '#4a6a3a', lash: true }, brows: 'soft', mouth: 'lips', lip: '#cf4a6e', clothes: T('tee', '#ff69b4'), acc: [{ type: 'sparkles', color: '#ffffff' }, { type: 'earrings', color: '#ffd36b' }] },
  woman_to_man: { skin: 'medium', head: { jaw: 0.85, chin: 56 }, hair: H('short', '#2a1a12', 'short'), eyes: { style: 'round', color: '#3a2a1a' }, brows: 'thick', mouth: 'smile', lip: '#8a4a3a', nose: 'strong', clothes: T('tee', '#4169e1'), acc: [{ type: 'beard', color: '#2a1a12' }] },
  adult_to_child: { skin: 'light', head: { w: 46, h: 58, chin: 46, jaw: 0.7 }, hair: H('short', '#d9a441', 'swept'), eyes: { style: 'dot' }, brows: 'raised', mouth: 'open', blush: true, nose: 'dot', clothes: T('tee', '#ffd700', { trim: '#e0a800' }), acc: ['freckles'] },
  child_to_adult: { skin: 'tan', head: { jaw: 0.8, chin: 58 }, hair: H('short', '#3a2416', 'parted'), eyes: { style: 'round', color: '#3a2a1a' }, brows: 'thick', mouth: 'neutral', nose: 'strong', clothes: T('suit', '#5a3a22', { shirt: '#f2eee8', tie: '#cd853f' }), acc: ['stubble'] },

  // ── Effects: Dark ────────────────────────────────────────────────────────────
  dark: { skin: 'black', hair: H('', '#000'), eyes: { style: 'glow', color: '#ff1a1a' }, brows: 'none', mouth: 'neutral', lip: '#000', clothes: T('robe', '#0b0b0f', { trim: '#2a0000' }), hoodColor: '#16161c', bg: '#4a0606' },
  demon: { skin: 'red', head: { jaw: 0.6 }, ears: 'pointed', hair: H('', '#000'), eyes: { style: 'glow', color: '#ffd400' }, brows: 'angry', browColor: '#3a0a0a', mouth: 'fangs', nose: 'strong', clothes: T('armor', '#2a0a0a'), acc: [{ type: 'horns', color: '#1a0606' }], bgPattern: 'flames' },
  dark_angel: { skin: 'pale', hair: H('long', '#120c18', 'side'), eyes: { style: 'glow', color: '#b14bff' }, brows: 'flat', mouth: 'lips', lip: '#3a1a3a', clothes: T('robe', '#1a1022', { trim: '#7a3aa0' }), acc: [{ type: 'wings', color: '#120a18' }, { type: 'halo', color: '#9a7aff', opacity: 0.8 }] },
  zombie: { skin: 'zombie', hair: H('messy-long', '#3a3a2a', 'messy'), eyes: { style: 'white' }, brows: 'sad', browColor: '#3a3a2a', mouth: 'stitched', clothes: T('tee', '#4a5a3a', { trim: '#2a3a1a' }), acc: ['stitches'] },
  venom: { special: 'symbiote', clothes: T('turtleneck', '#141418'), bg: '#2d2d2d' },
  spirit: { special: 'ghost', noTorso: true, bg: '#6a74c8', bgPattern: 'stars' },

  // ── Effects: Fun ─────────────────────────────────────────────────────────────
  chipmunk: { special: 'chipmunk', clothes: T('tee', '#ff8c00'), bgPattern: 'leaves' },
  baby: { skin: 'porcelain', head: { w: 48, h: 60, chin: 44, jaw: 0.8 }, hair: H('', '#e2b067'), eyes: { style: 'dot' }, brows: 'none', mouth: 'smile', blush: true, nose: 'dot', clothes: T('tee', '#ffb6c1', { trim: '#ff8aa0' }), acc: ['pacifier', { type: 'ribbon', color: '#7fd1ff', side: 1 }] },
  helium: { skin: 'fair', head: { jaw: 0.5 }, hair: H('bob', '#ffd23f', 'blunt'), eyes: { style: 'round', color: '#2a6aff' }, brows: 'raised', mouth: 'shout', blush: true, clothes: T('tee', '#ff1493'), acc: ['balloon'] },
  ogre: { skin: 'olive', head: { w: 52, h: 54, chin: 62, jaw: 0.95 }, ears: 'pointed', hair: H('', '#000'), eyes: { style: 'dot' }, brows: 'thick', browColor: '#3a4a22', mouth: 'grin', nose: 'strong', clothes: T('tee', '#6a4a2a'), acc: ['tusks'] },
  crazy: { skin: 'light', hair: H('afro', '#ff4500', 'afro'), eyes: { style: 'round', color: '#22aa44' }, brows: 'raised', mouth: 'open', clothes: T('tee', '#2a2a8a'), acc: ['sparkles'] },
  crazy_clown: { skin: '#f4f2ee', hair: H('curly', '#2bd1ff', 'curly'), eyes: { style: 'round', color: '#2a2a2a' }, brows: 'raised', browColor: '#111', mouth: 'grin', nose: 'clown', clothes: T('tee', '#ffd23f'), acc: ['clownPaint', 'collarFrill'] },

  // ── Effects: Communication ───────────────────────────────────────────────────
  telephone: { skin: 'light', hair: H('bob', '#5a3a2a', 'swept'), eyes: { style: 'round', color: '#3a5a7a', lash: true }, brows: 'soft', mouth: 'smile', lip: '#c24a5a', clothes: T('turtleneck', '#808080'), acc: ['phone'], bg: '#5c6470' },
  cop_radio: { skin: 'brown', head: { jaw: 0.8 }, hair: H('', '#111'), eyes: { style: 'round', color: '#2a1a12' }, brows: 'thick', mouth: 'neutral', nose: 'strong', clothes: T('suit', '#1f2d4a', { shirt: '#c9d6e8', tie: '#0f1626' }), acc: [{ type: 'policeCap', color: '#1f2d4a' }, { type: 'glasses', color: '#111', tint: '#1d2a3a' }, 'walkie'] },
  walkie_talkie: { skin: 'tan', head: { jaw: 0.8 }, hair: H('buzz', '#2a1a12', 'buzz'), eyes: { style: 'round', color: '#3a2a1a' }, brows: 'thick', mouth: 'open', clothes: T('tactical', '#556b2f'), acc: [{ type: 'beanie', color: '#3a4a2a' }, 'walkie'] },
  megaphone: { skin: 'fair', hair: H('ponytail', '#2a1a12', 'swept'), eyes: { style: 'round', color: '#3a2a1a' }, brows: 'raised', mouth: 'shout', clothes: T('hoodie', '#ff8c00'), acc: ['megaphone'] },

  // ── Effects: Environment ─────────────────────────────────────────────────────
  cave: { skin: 'tan', head: { jaw: 0.85 }, hair: H('messy-long', '#4a2a14', 'messy'), eyes: { style: 'round', color: '#3a2a1a' }, brows: 'thick', mouth: 'grin', nose: 'strong', clothes: T('tee', '#8b5a2b', { trim: '#5a3a1a' }), acc: [{ type: 'beard', color: '#4a2a14' }, 'bone'] },
  cathedral: { skin: 'light', hair: H('', '#000'), eyes: { style: 'shut' }, brows: 'soft', mouth: 'shout', clothes: T('robe', '#efe8ff', { trim: '#9370db' }), hoodColor: '#5a3d8a', acc: [{ type: 'halo', color: '#ffe27a', opacity: 0.6 }, 'notes'], bgPattern: 'rays' },
  underwater: { special: 'diver', skin: 'medium', hair: H('', '#000'), eyes: { style: 'round', color: '#2a4a6a' }, brows: 'raised', mouth: 'open', clothes: T('tactical', '#25424f'), bgPattern: 'bubbles' },

  // ── Effects: Musical ─────────────────────────────────────────────────────────
  magic_chords: { skin: 'porcelain', hair: H('long', '#ffe7a3', 'strands'), eyes: { style: 'anime', color: '#b07aff' }, brows: 'soft', mouth: 'open', blush: true, clothes: T('idol', '#fff6d6', { trim: '#ffd700' }), acc: [{ type: 'crown', color: '#ffd23f' }, { type: 'sparkles', color: '#fff3a6', points: [[40, 60], [212, 64], [204, 160], [48, 150]] }], bgPattern: 'stars' },
  autotune: { skin: 'medium', hair: H('short', '#141414', 'short'), eyes: { style: 'round', color: '#222' }, brows: 'flat', mouth: 'smile', clothes: T('jacket', '#0e2a22', { shirt: '#00fa9a' }), acc: [{ type: 'glasses', color: '#111', tint: '#00fa9a' }, { type: 'headphones', color: '#111', accent: '#00fa9a' }], bgPattern: 'notes' },
  vibrato_voice: { skin: 'brown', hair: H('wavy', '#1a0e08', 'side'), eyes: { style: 'shut' }, brows: 'raised', mouth: 'open', clothes: T('dress', '#ff69b4', { trim: '#c2477f' }), acc: ['mic', { type: 'hoops', color: '#ffd36b' }], bgPattern: 'notes' },
  double_voice: { special: 'twin', skin: 'light', skin2: '#c98a62', hair: H('short', '#2a1a12', 'swept'), hair2: H('short', '#0e0a08', 'swept'), eyes: { style: 'round', color: '#2a4a5a' }, brows: 'soft', mouth: 'open', clothes: T('tee', '#40e0d0') },
  octaver: { skin: 'pale', hair: H('spiky', '#111111'), eyes: { style: 'round', color: '#2a2a2a' }, brows: 'angry', mouth: 'grin', clothes: T('jacket', '#1a1a1a', { shirt: '#ff6347' }), acc: [{ type: 'earrings', color: '#ff6347' }, 'scar'], bgPattern: 'flames' },
  wah_wah: { skin: 'deep', hair: H('afro', '#1a0e08', 'afro'), eyes: { style: 'round', color: '#222' }, brows: 'raised', mouth: 'grin', clothes: T('jacket', '#ff8c00', { shirt: '#ffdd55' }), acc: [{ type: 'glasses', color: '#111', tint: '#ff8c00', round: true }], bgPattern: 'rays' },

  // ── Effects: Character ───────────────────────────────────────────────────────
  deep_voice: { skin: 'brown', head: { w: 48, jaw: 0.9, chin: 58 }, hair: H('buzz', '#111', 'buzz'), eyes: { style: 'round', color: '#2a1a12' }, brows: 'thick', mouth: 'neutral', nose: 'strong', clothes: T('turtleneck', '#3a2416'), acc: [{ type: 'beard', color: '#111' }] },
  storyteller: { skin: 'light', head: { jaw: 0.7 }, hair: H('curtain', '#e8e4dc', 'parted'), eyes: { style: 'happy' }, brows: 'thick', browColor: '#cfc8bc', mouth: 'smile', nose: 'strong', clothes: T('jacket', '#6a4a2a', { shirt: '#efe5cc' }), acc: [{ type: 'beard', color: '#ece8e0' }, { type: 'glasses', color: '#7a5a2a', round: true }, 'book'] },
  whisper: { skin: 'fair', hair: H('long', '#3a2a22', 'side'), eyes: { style: 'sleepy', color: '#6a7a8a' }, brows: 'raised', mouth: 'hush', clothes: T('turtleneck', '#c0c0c8'), acc: ['finger'] },
  speech_jammer: { skin: 'medium', hair: H('messy-long', '#1a1a22', 'messy'), eyes: { style: 'round', color: '#222' }, brows: 'raised', mouth: 'open', clothes: T('hoodie', '#ff4500'), acc: [{ type: 'glitch', c1: '#ff2b6d', c2: '#20e3ff' }] },

  // ── Effects: Retro / Gaming ──────────────────────────────────────────────────
  '8bit': { special: 'pixel', noTorso: true, bg: '#1d6b3a', bgPattern: 'pixels' },
  cs_ct: { skin: 'light', head: { jaw: 0.8 }, hair: H('', '#000'), eyes: { style: 'angry', color: '#2a4a6a' }, brows: 'thick', browColor: '#3a2a1a', mouth: 'neutral', clothes: T('tactical', '#2a3f5f'), acc: [{ type: 'helmet', color: '#2f4a6a', goggles: '#7fd4ff' }, 'headset'], bgPattern: 'grid' },
  cs_t: { skin: 'tan', hair: H('', '#000'), eyes: { style: 'angry', color: '#3a2a1a' }, brows: 'thick', browColor: '#1a1a1a', mouth: 'neutral', clothes: T('tactical', '#6a5a3a'), acc: [{ type: 'balaclava', color: '#1d1d1d' }, { type: 'bandana', color: '#b0332e' }] },
  announcer: { skin: 'tan', head: { jaw: 0.8 }, hair: H('short', '#1a120c', 'swept'), eyes: { style: 'round', color: '#2a1a12' }, brows: 'raised', mouth: 'grin', nose: 'strong', clothes: T('suit', '#121212', { shirt: '#ffffff', tie: '#ffd700' }), acc: ['headset', 'bowtie'], bgPattern: 'rays' },
  streamer: { skin: 'light', hair: H('long', '#a678ff', 'strands'), eyes: { style: 'anime', color: '#9146ff' }, brows: 'soft', mouth: 'open', blush: true, clothes: T('hoodie', '#2a1a4a'), acc: [{ type: 'headphones', color: '#141414', accent: '#9146ff', mic: true }, { type: 'catEars', color: '#2a1a4a', inner: '#9146ff', layer: 'head' }], bgPattern: 'grid' },

  // ── Effects: Horror / Nature ─────────────────────────────────────────────────
  possessed: { skin: 'ghost', hair: H('messy-long', '#141018', 'messy'), eyes: { style: 'white' }, brows: 'sad', browColor: '#2a1a2a', mouth: 'shout', clothes: T('dress', '#e4e0ea', { trim: '#a49aaa' }), acc: [{ type: 'veins', color: '#4b0082' }], bg: '#2a0a4a' },
  exorcist: { skin: 'fair', head: { jaw: 0.75 }, hair: H('short', '#2a2a2a', 'parted'), eyes: { style: 'round', color: '#3a3a3a' }, brows: 'angry', mouth: 'neutral', nose: 'strong', clothes: T('collar', '#151519'), acc: ['candle', 'stubble'], bg: '#4a0a0a' },
  forest: { skin: 'green', ears: 'pointed', head: { jaw: 0.5 }, hair: H('long', '#3a7a2a', 'strands'), eyes: { style: 'anime', color: '#ffd23f' }, brows: 'soft', browColor: '#2a5a1a', mouth: 'smile', lip: '#3a6a2a', clothes: T('robe', '#2a5a22', { trim: '#9adf6b' }), acc: ['leafCrown'], bgPattern: 'leaves' },
  wind: { skin: '#d8ecff', hair: H('wavy', '#bfe3ff', 'swept'), eyes: { style: 'shut' }, brows: 'soft', browColor: '#8ab6d8', mouth: 'smile', lip: '#6a9ac8', clothes: T('robe', '#e8f4ff', { trim: '#87ceeb' }), bgPattern: 'wind' },
  bypass: { skin: 'medium', hair: H('short', '#2a1a12', 'swept'), eyes: { style: 'round', color: '#3a2a1a' }, brows: 'soft', mouth: 'smile', clothes: T('tee', '#4a4a60') },
};
