// Aurora avatar kit: hand-built vector portraits (no image generation).
// Every voice is a spec (see voices.mjs) assembled from layered parts:
//   background → back hair / hood → torso → neck → ears → head → face
//   features → front hair → accessories → foreground props.
// Shading is two-tone (base + shadow/highlight shapes), the way flat
// editorial illustration is drawn, so the set reads as one designed family.

export const SIZE = 256;
const CX = 128;
const CY = 116; // head centre

// ── colour helpers ────────────────────────────────────────────────────────────
const hex2rgb = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const rgb2hex = (r) => '#' + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => rgb2hex(hex2rgb(a).map((v, i) => v + (hex2rgb(b)[i] - v) * t));
export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#000000', t);
const lum = (c) => { const [r, g, b] = hex2rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

// Skin tones (base). Shadow = darker + slightly warmer.
export const SKIN = {
  porcelain: '#f6e3d8', fair: '#f2d2bd', light: '#e9bd9c', medium: '#d39d74', tan: '#b97f55',
  brown: '#8d5a3b', deep: '#5e3a26', pale: '#e6e0ea', ghost: '#dfe6f2', grey: '#b9c0bc',
  green: '#8fbf5a', olive: '#7f9d5c', goblin: '#9bd14b', red: '#c8362e', blue: '#7fb7e6',
  violet: '#a58ad8', teal: '#2e6f68', metal: '#aeb6c2', bone: '#ede4d0', black: '#1d1d22', zombie: '#9fae8a',
};
const skinShadow = (s) => mix(darken(s, 0.18), '#a0302a', 0.08);

let uid = 0;
const id = (p) => `${p}${uid++}`;

// ── primitives ────────────────────────────────────────────────────────────────
const P = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const S = (d, stroke, w, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const E = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const C = (cx, cy, r, fill, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const G = (inner, extra = '') => `<g ${extra}>${inner}</g>`;

// ── head shapes ───────────────────────────────────────────────────────────────
// w: half width, h: crown height above CY, chin: chin below CY, jaw: 0..1
// width kept at the jaw (0.4 pointy anime, 0.9 square).
function headPath({ w = 44, h = 60, chin = 56, jaw = 0.62 } = {}) {
  const top = CY - h, c = CY + chin;
  return `M${CX - w},${CY - 6} C${CX - w},${top + 16} ${CX - w * 0.6},${top} ${CX},${top} `
    + `C${CX + w * 0.6},${top} ${CX + w},${top + 16} ${CX + w},${CY - 6} `
    + `C${CX + w + 1},${CY + 16} ${CX + w * jaw + 6},${c - 10} ${CX},${c} `
    + `C${CX - w * jaw - 6},${c - 10} ${CX - w - 1},${CY + 16} ${CX - w},${CY - 6}Z`;
}
// Shadow on the far (right) side of the face, clipped to the head.
function headShade(geo) {
  const { w = 44, chin = 56 } = geo;
  return `M${CX + w * 0.35},${CY - 70} C${CX + w * 0.95},${CY - 30} ${CX + w * 0.9},${CY + 30} ${CX + w * 0.1},${CY + chin + 4} L${CX + w + 10},${CY + chin + 10} L${CX + w + 10},${CY - 70}Z`;
}

// ── backgrounds ───────────────────────────────────────────────────────────────
function background(spec, defs) {
  const c = spec.bg;
  const g = id('bg');
  defs.push(`<radialGradient id="${g}" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${lighten(c, 0.22)}"/><stop offset="0.55" stop-color="${c}"/><stop offset="1" stop-color="${darken(c, 0.55)}"/></radialGradient>`);
  let out = `<rect width="${SIZE}" height="${SIZE}" fill="url(#${g})"/>`;
  // Soft halo behind the head for separation.
  out += E(CX, CY - 6, 92, 92, lighten(c, 0.35), 'opacity="0.18"');
  if (spec.bgPattern === 'rays') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      out += P(`M${CX},${CY} L${CX + Math.cos(a) * 200},${CY + Math.sin(a) * 200} L${CX + Math.cos(a + 0.18) * 200},${CY + Math.sin(a + 0.18) * 200}Z`, '#ffffff', 'opacity="0.06"');
    }
  } else if (spec.bgPattern === 'dots') {
    for (let y = 12; y < SIZE; y += 22) for (let x = (y / 22) % 2 ? 22 : 11; x < SIZE; x += 22) out += C(x, y, 1.6, '#ffffff', 'opacity="0.12"');
  } else if (spec.bgPattern === 'grid') {
    for (let x = 0; x <= SIZE; x += 24) out += S(`M${x},0 V${SIZE}`, '#ffffff', 1, 'opacity="0.07"');
    for (let y = 0; y <= SIZE; y += 24) out += S(`M0,${y} H${SIZE}`, '#ffffff', 1, 'opacity="0.07"');
  } else if (spec.bgPattern === 'bubbles') {
    [[40, 60, 9], [210, 90, 6], [196, 40, 4], [60, 170, 5], [220, 180, 10], [30, 120, 3]].forEach(([x, y, r]) => { out += C(x, y, r, 'none', `stroke="#ffffff" stroke-width="2" opacity="0.35"`); });
  } else if (spec.bgPattern === 'stars') {
    [[36, 44], [214, 58], [200, 150], [50, 140], [180, 26], [26, 96], [232, 110]].forEach(([x, y], i) => { out += star(x, y, 3 + (i % 3) * 1.5, '#ffffff', 'opacity="0.7"'); });
  } else if (spec.bgPattern === 'notes') {
    out += note(42, 70, '#ffffff', 0.35) + note(206, 54, '#ffffff', 0.3) + note(214, 150, '#ffffff', 0.25);
  } else if (spec.bgPattern === 'leaves') {
    [[34, 60, 20], [222, 72, -30], [210, 168, 40], [40, 160, -50]].forEach(([x, y, r]) => { out += leaf(x, y, r, '#ffffff', 0.18); });
  } else if (spec.bgPattern === 'wind') {
    out += S(`M14,70 C60,56 90,84 136,70 S200,56 244,70`, '#ffffff', 3, 'opacity="0.2"');
    out += S(`M24,190 C70,176 110,204 150,190 S210,176 244,190`, '#ffffff', 3, 'opacity="0.16"');
  } else if (spec.bgPattern === 'flames') {
    for (let i = 0; i < 9; i++) { const x = 8 + i * 30; out += P(`M${x},256 C${x - 6},226 ${x + 10},214 ${x + 4},186 C${x + 22},210 ${x + 26},232 ${x + 20},256Z`, '#ffcf6b', 'opacity="0.16"'); }
  } else if (spec.bgPattern === 'pixels') {
    for (let y = 0; y < SIZE; y += 16) for (let x = 0; x < SIZE; x += 16) if (((x * 7 + y * 13) / 16) % 5 < 1) out += `<rect x="${x}" y="${y}" width="16" height="16" fill="#ffffff" opacity="0.07"/>`;
  }
  return out;
}

const star = (x, y, r, fill, extra = '') => P(`M${x},${y - r * 2} C${x + r * 0.3},${y - r * 0.3} ${x + r * 0.3},${y - r * 0.3} ${x + r * 2},${y} C${x + r * 0.3},${y + r * 0.3} ${x + r * 0.3},${y + r * 0.3} ${x},${y + r * 2} C${x - r * 0.3},${y + r * 0.3} ${x - r * 0.3},${y + r * 0.3} ${x - r * 2},${y} C${x - r * 0.3},${y - r * 0.3} ${x - r * 0.3},${y - r * 0.3} ${x},${y - r * 2}Z`, fill, extra);
const note = (x, y, fill, op) => G(E(x, y + 18, 7, 5.5, fill) + `<rect x="${x + 5}" y="${y - 6}" width="2.6" height="24" fill="${fill}"/>` + P(`M${x + 7.6},${y - 6} C${x + 16},${y - 2} ${x + 18},${y + 4} ${x + 14},${y + 10} C${x + 15},${y + 4} ${x + 12},${y + 1} ${x + 7.6},${y}Z`, fill), `opacity="${op}"`);
const leaf = (x, y, rot, fill, op) => G(P(`M0,-14 C10,-6 10,6 0,14 C-10,6 -10,-6 0,-14Z`, fill) + S(`M0,-12 L0,12`, darken(fill, 0.2), 1), `transform="translate(${x},${y}) rotate(${rot})" opacity="${op}"`);

// ── torso / clothing ──────────────────────────────────────────────────────────
function torso(spec, defs) {
  const cl = spec.clothes || { style: 'tee', color: '#3b4252' };
  const col = cl.color;
  const g = id('cl');
  defs.push(`<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(col, 0.08)}"/><stop offset="1" stop-color="${darken(col, 0.25)}"/></linearGradient>`);
  const body = `M30,256 C30,222 62,200 104,194 L152,194 C194,200 226,222 226,256Z`;
  let out = P(body, `url(#${g})`);
  // Shoulder light on the left, shade on the right.
  out += P(`M30,256 C30,226 58,206 92,198 C70,214 58,232 56,256Z`, '#ffffff', 'opacity="0.08"');
  out += P(`M226,256 C226,226 198,206 164,198 C186,214 198,232 200,256Z`, '#000000', 'opacity="0.14"');
  const s = cl.style;
  const trim = cl.trim || darken(col, 0.3);
  if (s === 'tee' || s === 'idol' || s === 'dress') {
    out += P(`M106,194 C112,214 144,214 150,194Z`, skinShadow(spec.skinTone));
    out += S(`M104,194 C110,218 146,218 152,194`, trim, 3);
  }
  if (s === 'hoodie') {
    out += P(`M84,200 C96,226 160,226 172,200 C160,214 96,214 84,200Z`, darken(col, 0.18));
    out += S(`M112,214 L110,240`, lighten(col, 0.5), 2.5) + S(`M144,214 L146,240`, lighten(col, 0.5), 2.5);
    out += C(110, 242, 2.5, lighten(col, 0.5)) + C(146, 242, 2.5, lighten(col, 0.5));
  }
  if (s === 'suit') {
    out += P(`M110,194 L128,236 L146,194Z`, cl.shirt || '#f4f4f6');
    out += P(`M96,196 L128,256 L104,256 L84,206Z`, darken(col, 0.2)) + P(`M160,196 L128,256 L152,256 L172,206Z`, darken(col, 0.2));
    if (cl.tie !== false) out += P(`M124,204 L132,204 L136,240 L128,250 L120,240Z`, cl.tie || '#b33a3a');
  }
  if (s === 'turtleneck' || s === 'robe') {
    out += P(`M102,180 C104,200 152,200 154,180 L156,200 C150,212 106,212 100,200Z`, darken(col, 0.12));
    if (s === 'robe') out += S(`M128,206 L128,256`, cl.trim || lighten(col, 0.3), 3) + P(`M96,198 C110,226 146,226 160,198`, 'none', `stroke="${cl.trim || lighten(col, 0.3)}" stroke-width="3"`);
  }
  if (s === 'armor') {
    out += P(`M30,256 C30,222 50,206 82,198 C96,214 92,240 84,256Z`, lighten(col, 0.15));
    out += P(`M226,256 C226,222 206,206 174,198 C160,214 164,240 172,256Z`, darken(col, 0.05));
    out += P(`M100,200 L156,200 L150,256 L106,256Z`, darken(col, 0.18));
    out += S(`M108,214 L148,214 M110,230 L146,230`, lighten(col, 0.35), 2);
  }
  if (s === 'tactical') {
    out += P(`M88,202 L168,202 L176,256 L80,256Z`, darken(col, 0.2));
    out += `<rect x="94" y="222" width="24" height="18" rx="3" fill="${darken(col, 0.35)}"/><rect x="138" y="222" width="24" height="18" rx="3" fill="${darken(col, 0.35)}"/>`;
    out += S(`M92,204 L104,256 M164,204 L152,256`, darken(col, 0.4), 4);
  }
  if (s === 'collar') { // priest
    out += P(`M106,194 C112,212 144,212 150,194 L150,204 C140,214 116,214 106,204Z`, '#141418');
    out += `<rect x="122" y="198" width="12" height="7" rx="2" fill="#f4f4f6"/>`;
  }
  if (s === 'jacket') {
    out += P(`M104,194 L120,256 L96,256 L82,206Z`, darken(col, 0.22)) + P(`M152,194 L136,256 L160,256 L174,206Z`, darken(col, 0.22));
    out += P(`M110,194 C116,210 140,210 146,194Z`, cl.shirt || '#22252b');
  }
  if (s === 'idol') {
    out += P(`M116,206 C106,196 98,204 104,212 C110,218 120,212 128,208 C136,212 146,218 152,212 C158,204 150,196 140,206 Z`, cl.trim || '#ffffff');
    out += C(128, 208, 4.5, darken(cl.trim || '#ffd1e8', 0.2));
  }
  if (s === 'metal') {
    out += S(`M60,226 L196,226`, lighten(col, 0.3), 2, 'opacity="0.6"') + C(70, 236, 3, lighten(col, 0.4)) + C(186, 236, 3, lighten(col, 0.4));
  }
  return out;
}

function neck(spec) {
  if (spec.noNeck) return '';
  const sk = spec.skinTone;
  return P(`M110,150 L110,200 C118,206 138,206 146,200 L146,150Z`, sk)
    + P(`M110,160 C120,178 136,178 146,160 L146,182 C136,188 120,188 110,182Z`, skinShadow(sk), 'opacity="0.9"');
}

function ears(spec) {
  if (spec.noEars) return '';
  const sk = spec.skinTone, w = (spec.head || {}).w || 44;
  const pointed = spec.ears === 'pointed';
  const ear = (x, flip) => pointed
    ? P(`M${x},${CY - 2} C${x + flip * 10},${CY - 10} ${x + flip * 30},${CY - 34} ${x + flip * 34},${CY - 40} C${x + flip * 26},${CY - 14} ${x + flip * 20},${CY + 16} ${x},${CY + 18}Z`, sk)
    : E(x, CY + 4, 8, 12, sk);
  return ear(CX - w + 2, -1) + ear(CX + w - 2, 1)
    + (pointed ? '' : E(CX - w + 1, CY + 5, 4, 7, skinShadow(sk)) + E(CX + w - 1, CY + 5, 4, 7, skinShadow(sk)));
}

// ── face features ─────────────────────────────────────────────────────────────
function eyes(spec, defs) {
  const e = spec.eyes || { style: 'round', color: '#4a3226' };
  const ex = e.spread || 19, ey = CY + (e.y || 6);
  const col = e.color || '#4a3226';
  let out = '';
  const each = (fn) => fn(CX - ex, -1) + fn(CX + ex, 1);
  const lash = spec.lashColor || '#20151a';
  switch (e.style) {
    case 'anime': {
      const g = id('iris');
      defs.push(`<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${darken(col, 0.45)}"/><stop offset="1" stop-color="${lighten(col, 0.25)}"/></linearGradient>`);
      out += each((x) => E(x, ey + 1, 9.5, 11.5, '#ffffff'));
      out += each((x) => E(x, ey + 2, 7.6, 10, `url(#${g})`));
      out += each((x) => E(x, ey + 3, 3.4, 4.6, darken(col, 0.7)));
      out += each((x, f) => C(x - 2.6 * f * -1 - 2.2, ey - 2, 2.8, '#ffffff') + C(x + 2.6, ey + 6, 1.3, '#ffffff', 'opacity="0.85"'));
      out += each((x, f) => S(`M${x - 11},${ey - 6} C${x - 6},${ey - 12} ${x + 6},${ey - 12} ${x + 11},${ey - 5}`, lash, 3.4)
        + S(`M${x + f * 10},${ey - 6} L${x + f * 13},${ey - 9}`, lash, 2.2));
      break;
    }
    case 'sleepy': {
      out += each((x) => E(x, ey + 1, 8.5, 6, '#ffffff'));
      out += each((x) => E(x, ey + 2, 5, 5.2, col));
      out += each((x) => C(x, ey + 2, 2.3, darken(col, 0.7)));
      out += each((x) => P(`M${x - 10},${ey - 1} C${x - 5},${ey - 4} ${x + 5},${ey - 4} ${x + 10},${ey - 1} L${x + 10},${ey - 8} L${x - 10},${ey - 8}Z`, spec.skinTone));
      out += each((x) => S(`M${x - 10},${ey - 1} C${x - 5},${ey - 4} ${x + 5},${ey - 4} ${x + 10},${ey - 1}`, lash, 2.6));
      break;
    }
    case 'happy':
      out += each((x) => S(`M${x - 8},${ey + 2} C${x - 4},${ey - 6} ${x + 4},${ey - 6} ${x + 8},${ey + 2}`, lash, 3.2));
      break;
    case 'dot':
      out += each((x) => E(x, ey + 1, 4, 5, '#2a1e1e') + C(x - 1.4, ey - 1, 1.4, '#ffffff'));
      break;
    case 'glow': {
      const f = id('glow');
      defs.push(`<filter id="${f}" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="3"/></filter>`);
      out += each((x) => E(x, ey + 1, 10, 6, col, `filter="url(#${f})" opacity="0.9"`));
      out += each((x, fl) => P(`M${x - 10},${ey + 1} C${x - 4},${ey - 6} ${x + 6},${ey - 5} ${x + 10},${ey + fl * 0 - 1} C${x + 4},${ey + 6} ${x - 5},${ey + 6} ${x - 10},${ey + 1}Z`, lighten(col, 0.55)));
      break;
    }
    case 'void':
      out += each((x) => P(`M${x - 10},${ey + 1} C${x - 6},${ey - 8} ${x + 6},${ey - 8} ${x + 10},${ey + 1} C${x + 6},${ey + 9} ${x - 6},${ey + 9} ${x - 10},${ey + 1}Z`, '#0b0b10'));
      if (e.pupil) out += each((x) => C(x, ey + 1, 2.4, e.pupil));
      break;
    case 'white':
      out += each((x) => P(`M${x - 10},${ey + 1} C${x - 6},${ey - 6} ${x + 6},${ey - 6} ${x + 10},${ey + 1} C${x + 6},${ey + 7} ${x - 6},${ey + 7} ${x - 10},${ey + 1}Z`, '#f2f2f2'))
        + each((x) => S(`M${x - 10},${ey + 1} C${x - 6},${ey - 6} ${x + 6},${ey - 6} ${x + 10},${ey + 1}`, '#3a1f2e', 2));
      break;
    case 'angry': {
      out += each((x) => P(`M${x - 10},${ey + 2} C${x - 6},${ey - 4} ${x + 6},${ey - 5} ${x + 10},${ey} C${x + 6},${ey + 7} ${x - 6},${ey + 7} ${x - 10},${ey + 2}Z`, '#ffffff'));
      out += each((x) => C(x, ey + 2, 4.4, col) + C(x, ey + 2, 2, '#130c0c') + C(x - 1.4, ey + 0.5, 1, '#ffffff'));
      out += each((x, f) => S(`M${x - 11},${ey - 2 + (f < 0 ? -2 : 2)} L${x + 11},${ey - 2 + (f < 0 ? 2 : -2)}`, lash, 3));
      break;
    }
    case 'shut':
      out += each((x) => S(`M${x - 8},${ey + 1} C${x - 4},${ey + 5} ${x + 4},${ey + 5} ${x + 8},${ey + 1}`, lash, 3));
      break;
    default: { // round: almond eye, iris tucked under the upper lid
      const almond = (x) => `M${x - 11},${ey + 1} C${x - 7},${ey - 7.5} ${x + 6},${ey - 8} ${x + 11},${ey} C${x + 6},${ey + 6.5} ${x - 6},${ey + 7} ${x - 11},${ey + 1}Z`;
      out += each((x) => {
        const cp = id('eye');
        defs.push(`<clipPath id="${cp}"><path d="${almond(x)}"/></clipPath>`);
        return P(almond(x), '#fbf8f6')
          + `<g clip-path="url(#${cp})">` + C(x + 0.5, ey + 0.5, 5.8, col) + C(x + 0.5, ey + 0.5, 5.8, 'none', `stroke="${darken(col, 0.45)}" stroke-width="1.2"`)
          + C(x + 0.5, ey + 0.5, 2.6, '#0d0907') + C(x - 1.6, ey - 1.6, 1.6, '#ffffff') + C(x + 2.6, ey + 2.6, 0.8, '#ffffff', 'opacity="0.8"')
          + P(`M${x - 12},${ey - 8} L${x + 12},${ey - 8} L${x + 12},${ey - 2} C${x + 6},${ey - 6} ${x - 6},${ey - 6} ${x - 12},${ey - 2}Z`, '#000000', 'opacity="0.12"') + '</g>';
      });
      out += each((x, f) => P(`M${x - 11.5},${ey + 1} C${x - 7},${ey - 8.5} ${x + 6},${ey - 9} ${x + 11.5},${ey} C${x + 6},${ey - 6.5} ${x - 7},${ey - 6} ${x - 11.5},${ey + 1}Z`, lash, `transform="translate(0 ${e.lash ? 0 : 0.6})"`));
      out += each((x) => S(`M${x - 7},${ey - 10} C${x - 3},${ey - 12.5} ${x + 3},${ey - 12.5} ${x + 8},${ey - 9.5}`, skinShadow(spec.skinTone), 1.1, 'opacity="0.5"'));
      out += each((x) => S(`M${x - 8},${ey + 6} C${x - 3},${ey + 8.5} ${x + 3},${ey + 8.5} ${x + 8},${ey + 5.5}`, skinShadow(spec.skinTone), 1.2, 'opacity="0.7"'));
      // Lashes: a single tapered wing at the outer corner.
      if (e.lash) out += each((x, f) => P(`M${x + f * 9},${ey - 4} C${x + f * 12},${ey - 4} ${x + f * 14},${ey - 5} ${x + f * 16},${ey - 7} C${x + f * 14.5},${ey - 2.5} ${x + f * 12.5},${ey + 0.5} ${x + f * 11},${ey + 0.5}Z`, lash));
    }
  }
  return out;
}

function brows(spec) {
  const b = spec.brows || 'soft';
  if (b === 'none') return '';
  const col = spec.browColor || darken(spec.hair?.color || '#3a2a20', 0.25);
  const ey = CY + ((spec.eyes || {}).y || 6);
  const ex = (spec.eyes || {}).spread || 19;
  const anime = (spec.eyes || {}).style === 'anime';
  const y = ey - (anime ? 19 : 15);
  const thick = b === 'thick' ? 1.6 : 1;
  // Tapered brow: inner end at the nose side (f = -1 left brow, +1 right brow).
  // lift: outer-end height change; arch: mid-point rise.
  const shape = { soft: [2, 4], thick: [1, 3], raised: [4, 7], angry: [-6, 1], sad: [5, 1], flat: [0, 1.5] }[b] || [2, 4];
  const [lift, arch] = shape;
  const brow = (x, f) => {
    const inner = x - f * 9, outer = x + f * 10;
    const yi = y + (b === 'angry' ? 4 : b === 'sad' ? -3 : 0), yo = y - lift + 2;
    const t1 = 2.2 * thick, t2 = 0.8 * thick;
    return P(`M${inner},${yi - t1} C${x - f * 2},${y - arch - t1} ${x + f * 5},${y - arch - 1} ${outer},${yo} `
      + `C${x + f * 5},${y - arch + 1.2} ${x - f * 2},${y - arch + t1 * 0.6} ${inner},${yi + t2 + 1}Z`, col);
  };
  return brow(CX - ex, -1) + brow(CX + ex, 1);
}

function nose(spec) {
  const n = spec.nose || 'soft';
  const sh = skinShadow(spec.skinTone);
  if (n === 'none') return '';
  if (n === 'dot') return E(CX, CY + 22, 2.4, 1.6, sh);
  if (n === 'clown') return C(CX, CY + 20, 7.5, '#e0262b') + C(CX - 2.4, CY + 17.5, 2.2, '#ff8a8a');
  if (n === 'strong') return S(`M${CX - 2},${CY + 6} C${CX - 6},${CY + 18} ${CX - 8},${CY + 24} ${CX - 2},${CY + 26} C${CX + 2},${CY + 27} ${CX + 6},${CY + 26} ${CX + 7},${CY + 24}`, sh, 2.6);
  return P(`M${CX + 3},${CY + 8} C${CX + 6},${CY + 16} ${CX + 9},${CY + 21} ${CX + 6},${CY + 25} C${CX + 3},${CY + 27} ${CX - 1},${CY + 27} ${CX - 4},${CY + 25} C${CX},${CY + 24} ${CX + 3},${CY + 22} ${CX + 3},${CY + 18}Z`, sh, 'opacity="0.55"')
    + S(`M${CX - 6},${CY + 24} C${CX - 3},${CY + 27} ${CX + 3},${CY + 27} ${CX + 6},${CY + 24}`, darken(sh, 0.12), 1.8)
    + E(CX - 3, CY + 15, 1.6, 4, '#ffffff', 'opacity="0.22"');
}

function mouth(spec) {
  const m = spec.mouth || 'smile';
  const y = CY + 36 + ((spec.head || {}).chin ? ((spec.head.chin - 56) * 0.35) : 0);
  const lip = spec.lip || '#b4475a';
  switch (m) {
    case 'open':
      return P(`M${CX - 11},${y - 2} C${CX - 8},${y + 12} ${CX + 8},${y + 12} ${CX + 11},${y - 2}Z`, '#5a1c25')
        + P(`M${CX - 6},${y + 6} C${CX - 3},${y + 2} ${CX + 3},${y + 2} ${CX + 6},${y + 6} C${CX + 3},${y + 9} ${CX - 3},${y + 9} ${CX - 6},${y + 6}Z`, '#e06f80')
        + P(`M${CX - 9},${y - 1} L${CX + 9},${y - 1} L${CX + 8},${y + 2} L${CX - 8},${y + 2}Z`, '#ffffff');
    case 'grin':
      return P(`M${CX - 13},${y - 3} C${CX - 8},${y + 9} ${CX + 8},${y + 9} ${CX + 13},${y - 3}Z`, '#ffffff')
        + S(`M${CX - 13},${y - 3} C${CX - 8},${y + 9} ${CX + 8},${y + 9} ${CX + 13},${y - 3} Z`, '#3a1a1a', 2);
    case 'fangs':
      return P(`M${CX - 12},${y - 2} C${CX - 7},${y + 9} ${CX + 7},${y + 9} ${CX + 12},${y - 2}Z`, '#3a0f14')
        + P(`M${CX - 8},${y - 1} L${CX - 5},${y + 6} L${CX - 3},${y - 1}Z`, '#ffffff') + P(`M${CX + 8},${y - 1} L${CX + 5},${y + 6} L${CX + 3},${y - 1}Z`, '#ffffff');
    case 'smirk':
      return S(`M${CX - 8},${y + 1} C${CX - 2},${y + 3} ${CX + 5},${y + 2} ${CX + 10},${y - 3}`, lip, 3);
    case 'neutral':
      return S(`M${CX - 7},${y + 1} L${CX + 7},${y + 1}`, darken(lip, 0.2), 2.6);
    case 'frown':
      return S(`M${CX - 9},${y + 4} C${CX - 4},${y - 2} ${CX + 4},${y - 2} ${CX + 9},${y + 4}`, darken(lip, 0.2), 2.8);
    case 'shout':
      return E(CX, y + 3, 8, 10, '#3a0f14') + E(CX, y + 9, 5, 3.4, '#d9606f');
    case 'lips':
      return P(`M${CX - 11},${y} C${CX - 5},${y - 5} ${CX - 1},${y - 2} ${CX},${y - 1} C${CX + 1},${y - 2} ${CX + 5},${y - 5} ${CX + 11},${y} C${CX + 5},${y + 7} ${CX - 5},${y + 7} ${CX - 11},${y}Z`, lip)
        + S(`M${CX - 10},${y} C${CX - 4},${y + 1} ${CX + 4},${y + 1} ${CX + 10},${y}`, darken(lip, 0.35), 1.4)
        + E(CX - 3, y + 3, 3, 1.3, '#ffffff', 'opacity="0.35"');
    case 'cat':
      return S(`M${CX - 9},${y} C${CX - 6},${y + 5} ${CX - 2},${y + 5} ${CX},${y} C${CX + 2},${y + 5} ${CX + 6},${y + 5} ${CX + 9},${y}`, '#3a1a1a', 2.4);
    case 'stitched':
      return S(`M${CX - 12},${y + 1} L${CX + 12},${y + 1}`, '#2a1a1a', 2.4) + [-9, -4, 1, 6, 11].map((d) => S(`M${CX + d - 1},${y - 4} L${CX + d + 1},${y + 6}`, '#2a1a1a', 1.8)).join('');
    case 'sharp':
      return P(`M${CX - 14},${y - 3} C${CX - 8},${y + 8} ${CX + 8},${y + 8} ${CX + 14},${y - 3} Z`, '#1d0b0b')
        + P([-12, -7, -2, 3, 8].map((d, i) => `M${CX + d},${y - 2} L${CX + d + 2.5},${y + 4} L${CX + d + 5},${y - 2}`).join(' '), '#ffffff');
    case 'hush':
      return S(`M${CX - 6},${y + 1} L${CX + 6},${y + 1}`, darken(lip, 0.2), 2.6);
    default: // smile: upper-lip line, soft lower lip, dimple corners
      return P(`M${CX - 11},${y} C${CX - 5},${y + 9} ${CX + 5},${y + 9} ${CX + 11},${y} C${CX + 5},${y + 4} ${CX - 5},${y + 4} ${CX - 11},${y}Z`, lip, 'opacity="0.9"')
        + S(`M${CX - 12},${y - 0.5} C${CX - 5},${y + 4} ${CX + 5},${y + 4} ${CX + 12},${y - 0.5}`, darken(lip, 0.45), 2)
        + S(`M${CX - 13.5},${y - 2} L${CX - 11.5},${y}`, darken(lip, 0.35), 1.6) + S(`M${CX + 13.5},${y - 2} L${CX + 11.5},${y}`, darken(lip, 0.35), 1.6)
        + E(CX, y + 6.5, 4, 1.2, '#ffffff', 'opacity="0.28"');
  }
}

function cheeks(spec) {
  if (!spec.blush) return '';
  const c = spec.blush === true ? '#ff7a8a' : spec.blush;
  return E(CX - 27, CY + 22, 8, 4.5, c, 'opacity="0.45"') + E(CX + 27, CY + 22, 8, 4.5, c, 'opacity="0.45"');
}

// ── hair ──────────────────────────────────────────────────────────────────────
function hairGrad(spec, defs) {
  if (spec._hairGrad) return spec._hairGrad;
  const c = spec.hair.color, g = id('hair');
  defs.push(`<linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="${CX - 20}" y1="${CY - 90}" x2="${CX + 30}" y2="${CY + 110}"><stop offset="0" stop-color="${lighten(c, 0.14)}"/><stop offset="0.45" stop-color="${c}"/><stop offset="1" stop-color="${darken(c, 0.32)}"/></linearGradient>`);
  spec._hairGrad = `url(#${g})`;
  return spec._hairGrad;
}

function hairBack(spec, defs) {
  const h = spec.hair;
  if (!h || !h.style) return '';
  const fill = hairGrad(spec, defs);
  const dark = darken(h.color, 0.35);
  const w = (spec.head || {}).w || 44;
  const top = CY - ((spec.head || {}).h || 60);
  switch (h.style) {
    case 'long': case 'long-straight': case 'hime':
      return P(`M${CX - w - 10},${CY - 16} C${CX - w - 16},${top - 4} ${CX - 30},${top - 16} ${CX},${top - 16} C${CX + 30},${top - 16} ${CX + w + 16},${top - 4} ${CX + w + 10},${CY - 16} C${CX + w + 16},${CY + 50} ${CX + w + 22},${CY + 90} ${CX + w + 14},236 L${CX - w - 14},236 C${CX - w - 22},${CY + 90} ${CX - w - 16},${CY + 50} ${CX - w - 10},${CY - 16}Z`, fill);
    case 'wavy':
      return P(`M${CX - w - 10},${CY - 16} C${CX - w - 18},${top - 4} ${CX - 30},${top - 18} ${CX},${top - 18} C${CX + 30},${top - 18} ${CX + w + 18},${top - 4} ${CX + w + 10},${CY - 16} C${CX + w + 30},${CY + 10} ${CX + w + 14},${CY + 40} ${CX + w + 28},${CY + 66} C${CX + w + 36},${CY + 84} ${CX + w + 20},${CY + 104} ${CX + w + 26},228 L${CX - w - 26},228 C${CX - w - 20},${CY + 104} ${CX - w - 36},${CY + 84} ${CX - w - 28},${CY + 66} C${CX - w - 14},${CY + 40} ${CX - w - 30},${CY + 10} ${CX - w - 10},${CY - 16}Z`, fill);
    case 'bob':
      return P(`M${CX - w - 12},${CY - 10} C${CX - w - 16},${top - 6} ${CX - 30},${top - 16} ${CX},${top - 16} C${CX + 30},${top - 16} ${CX + w + 16},${top - 6} ${CX + w + 12},${CY - 10} C${CX + w + 14},${CY + 30} ${CX + w + 12},${CY + 50} ${CX + w},${CY + 56} L${CX - w},${CY + 56} C${CX - w - 12},${CY + 50} ${CX - w - 14},${CY + 30} ${CX - w - 12},${CY - 10}Z`, fill);
    case 'twintails':
      return P(`M${CX - w - 4},${CY - 34} C${CX - w - 46},${CY - 20} ${CX - w - 40},${CY + 60} ${CX - w - 20},${CY + 100} C${CX - w - 30},${CY + 50} ${CX - w - 12},${CY + 10} ${CX - w + 2},${CY - 14}Z`, fill)
        + P(`M${CX + w + 4},${CY - 34} C${CX + w + 46},${CY - 20} ${CX + w + 40},${CY + 60} ${CX + w + 20},${CY + 100} C${CX + w + 30},${CY + 50} ${CX + w + 12},${CY + 10} ${CX + w - 2},${CY - 14}Z`, fill)
        + P(`M${CX - w - 6},${CY} C${CX - w - 10},${top - 6} ${CX - 30},${top - 14} ${CX},${top - 14} C${CX + 30},${top - 14} ${CX + w + 10},${top - 6} ${CX + w + 6},${CY}Z`, fill);
    case 'ponytail':
      return P(`M${CX + 20},${top + 6} C${CX + 80},${top - 6} ${CX + 86},${CY + 40} ${CX + 66},${CY + 96} C${CX + 70},${CY + 40} ${CX + 52},${CY - 10} ${CX + 26},${CY - 20}Z`, fill)
        + P(`M${CX - w - 6},${CY - 6} C${CX - w - 10},${top - 6} ${CX - 30},${top - 14} ${CX},${top - 14} C${CX + 30},${top - 14} ${CX + w + 10},${top - 6} ${CX + w + 6},${CY - 6}Z`, fill);
    case 'buns':
      return C(CX - 38, top - 14, 19, fill) + C(CX + 38, top - 14, 19, fill)
        + C(CX - 44, top - 20, 6, lighten(h.color, 0.4), 'opacity="0.35"') + C(CX + 32, top - 20, 6, lighten(h.color, 0.4), 'opacity="0.35"')
        + P(`M${CX - w - 6},${CY - 4} C${CX - w - 10},${top - 6} ${CX - 30},${top - 14} ${CX},${top - 14} C${CX + 30},${top - 14} ${CX + w + 10},${top - 6} ${CX + w + 6},${CY - 4}Z`, fill);
    case 'bun':
      return C(CX, top - 12, 18, fill) + P(`M${CX - w - 6},${CY - 4} C${CX - w - 10},${top - 6} ${CX - 30},${top - 14} ${CX},${top - 14} C${CX + 30},${top - 14} ${CX + w + 10},${top - 6} ${CX + w + 6},${CY - 4}Z`, fill);
    case 'curly': {
      let out = '';
      const pts = [[-48, -40, 22], [-30, -58, 24], [-6, -66, 24], [20, -62, 24], [42, -46, 22], [54, -20, 18], [-56, -16, 18], [-54, 10, 16], [56, 8, 16]];
      pts.forEach(([dx, dy, r]) => { out += C(CX + dx, CY + dy, r, fill); });
      return out;
    }
    case 'afro': {
      let out = C(CX, CY - 30, 76, fill);
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; out += C(CX + Math.cos(a) * 70, CY - 30 + Math.sin(a) * 70, 16, fill); }
      return out;
    }
    case 'messy-long':
      return P(`M${CX - w - 12},${CY - 20} C${CX - w - 30},${top} ${CX - 30},${top - 22} ${CX + 4},${top - 18} C${CX + 40},${top - 20} ${CX + w + 26},${top} ${CX + w + 12},${CY - 20} C${CX + w + 30},${CY + 30} ${CX + w + 16},${CY + 60} ${CX + w + 26},${CY + 96} L${CX + w - 4},${CY + 80} L${CX + w + 4},${CY + 110} L${CX - w - 4},${CY + 110} L${CX - w + 4},${CY + 80} L${CX - w - 26},${CY + 96} C${CX - w - 16},${CY + 60} ${CX - w - 30},${CY + 30} ${CX - w - 12},${CY - 20}Z`, fill);
    case 'tentacles': {
      let out = '';
      for (let i = 0; i < 7; i++) {
        const x = CX - 60 + i * 20, sway = (i % 2 ? 1 : -1) * 14;
        out += P(`M${x - 9},${CY - 20} C${x - 12 + sway},${CY + 30} ${x + sway},${CY + 70} ${x + sway * 0.4},${CY + 110} C${x + 6 + sway},${CY + 70} ${x + 12},${CY + 30} ${x + 9},${CY - 20}Z`, fill);
      }
      return out;
    }
    default:
      return '';
  }
}

function hairFront(spec, defs) {
  const h = spec.hair;
  if (!h || !h.style) return '';
  const fill = hairGrad(spec, defs);
  const shade = darken(h.color, 0.32);
  const hi = lighten(h.color, 0.5);
  const w = (spec.head || {}).w || 44;
  const top = CY - ((spec.head || {}).h || 60);
  const anime = (spec.eyes || {}).style === 'anime' || h.shine === 'ring';
  // Crown: hair volume sits outside the skull, down to the temples.
  const crown = `M${CX - w - 7},${CY + 2} C${CX - w - 12},${top - 4} ${CX - 34},${top - 20} ${CX + 2},${top - 20} C${CX + 36},${top - 20} ${CX + w + 12},${top - 4} ${CX + w + 7},${CY + 2}`;
  // Anime-style shine ring, or a soft sheen for other styles.
  const shine = anime
    ? [[-30, 22, -16, 16], [-12, 15, 4, 14], [10, 15, 26, 19], [30, 22, 38, 28]].map(([a, ay, b, by]) => S(`M${CX + a},${top + ay - 8} C${CX + (a + b) / 2},${top + Math.min(ay, by) - 13} ${CX + (a + b) / 2},${top + Math.min(ay, by) - 13} ${CX + b},${top + by - 8}`, hi, 4.2, 'opacity="0.55"')).join('')
    : P(`M${CX - 38},${top + 2} C${CX - 22},${top - 14} ${CX + 4},${top - 16} ${CX + 22},${top - 12} C${CX + 2},${top - 6} ${CX - 20},${top - 2} ${CX - 38},${top + 2}Z`, hi, 'opacity="0.32"');
  // Fringe casts a soft shadow on the forehead.
  const cast = (d) => G(P(d, '#000000'), `opacity="0.13" transform="translate(2 5)"`);
  // Tapered locks between valleys; tips = [[x, y], ...] left→right order is irrelevant.
  const locks = (tips, valleyY) => {
    const xs = tips.map((t) => t[0]);
    let d = `${crown} L${CX + w + 3},${CY - 14}`;
    let px = CX + w + 3, py = CY - 14;
    tips.forEach(([tx, ty], i) => {
      const nx = i + 1 < tips.length ? (tx + tips[i + 1][0]) / 2 : CX - w - 3;
      const ny = i + 1 < tips.length ? valleyY + (i % 2 ? -3 : 3) : CY - 10;
      d += ` C${px - 2},${py + 10} ${tx + 6},${ty - 12} ${tx},${ty}`;
      d += ` C${tx - 3},${ty - 14} ${nx + 4},${ny + 8} ${nx},${ny}`;
      px = nx; py = ny;
    });
    return d + ` L${CX - w - 7},${CY + 2}Z`;
  };
  // Face-framing locks in front of the ears.
  const sidelocks = (len = 46) => {
    const lock = (f) => P(`M${CX + f * (w + 7)},${CY - 28} C${CX + f * (w + 11)},${CY + 8} ${CX + f * (w + 4)},${CY + len - 8} ${CX + f * (w * 0.55)},${CY + len + 4} C${CX + f * (w * 0.72)},${CY + len - 14} ${CX + f * (w - 2)},${CY + 18} ${CX + f * (w - 4)},${CY - 18}Z`, fill)
      + S(`M${CX + f * (w + 3)},${CY - 8} C${CX + f * (w + 5)},${CY + 16} ${CX + f * (w + 1)},${CY + 32} ${CX + f * (w * 0.66)},${CY + len - 2}`, shade, 1.3, 'opacity="0.45"');
    return lock(-1) + lock(1);
  };
  const longish = ['long', 'wavy', 'twintails', 'hime', 'messy-long'].includes(h.style) && !h.noSidelocks;
  const frame = longish ? sidelocks(h.style === 'hime' ? 52 : 44) : '';
  let d;
  switch (h.fringe || h.style) {
    case 'none':
      return frame;
    case 'blunt': case 'hime': case 'bob': // straight-cut fringe, slightly arched, finely notched
      d = `${crown} L${CX + w + 3},${CY - 12} C${CX + 30},${CY - 20} ${CX + 16},${CY - 22} ${CX + 8},${CY - 20} L${CX + 4},${CY - 15} L${CX},${CY - 21} C${CX - 14},${CY - 22} ${CX - 30},${CY - 20} ${CX - w - 3},${CY - 12} L${CX - w - 7},${CY + 2}Z`;
      return cast(d) + P(d, fill) + S(`M${CX + 18},${CY - 40} L${CX + 14},${CY - 22} M${CX - 18},${CY - 40} L${CX - 16},${CY - 22}`, shade, 1.4, 'opacity="0.45"') + frame + shine;
    case 'side': // big swoop from the right temple to the left brow
      d = `${crown} L${CX + w + 2},${CY - 22} C${CX + 22},${CY - 46} ${CX - 12},${CY - 34} ${CX - 28},${CY - 12} C${CX - 34},${CY - 4} ${CX - 40},${CY + 6} ${CX - w - 7},${CY + 14}Z`;
      return cast(d) + P(d, fill) + S(`M${CX + 30},${CY - 52} C${CX + 6},${CY - 44} ${CX - 14},${CY - 30} ${CX - 30},${CY - 6}`, shade, 1.6, 'opacity="0.5"') + S(`M${CX + 10},${CY - 56} C${CX - 8},${CY - 46} ${CX - 22},${CY - 34} ${CX - 36},${CY - 14}`, shade, 1.2, 'opacity="0.35"') + frame + shine;
    case 'parted': case 'curtain': // centre part, hair sweeping to both sides
      d = `${crown} L${CX + w + 2},${CY - 8} C${CX + 30},${CY - 22} ${CX + 12},${CY - 34} ${CX + 2},${CY - 46} C${CX - 10},${CY - 34} ${CX - 30},${CY - 22} ${CX - w - 2},${CY - 8} L${CX - w - 7},${CY + 2}Z`;
      return cast(d) + P(d, fill) + S(`M${CX + 2},${CY - 46} C${CX + 4},${CY - 56} ${CX + 2},${top - 8} ${CX - 2},${top - 16}`, shade, 1.6, 'opacity="0.6"') + frame + shine;
    case 'strands': // anime bangs: tapered locks
      d = locks([[CX + 30, CY - 12], [CX + 14, CY - 4], [CX - 2, CY - 10], [CX - 18, CY - 3], [CX - 34, CY - 9]], CY - 30);
      return cast(d) + P(d, fill) + frame + shine;
    case 'swept': // locks swept to one side
      d = locks([[CX + 26, CY - 16], [CX + 6, CY - 10], [CX - 16, CY - 6], [CX - 36, CY - 2]], CY - 30);
      return cast(d) + P(d, fill) + frame + shine;
    case 'messy':
      d = locks([[CX + 36, CY - 4], [CX + 18, CY - 14], [CX + 4, CY + 2], [CX - 14, CY - 12], [CX - 30, CY], [CX - 42, CY - 10]], CY - 26);
      return cast(d) + P(d, fill) + frame + shine;
    case 'short': // tidy crop with a little quiff
      d = `M${CX - w - 3},${CY - 2} C${CX - w - 8},${top - 6} ${CX - 30},${top - 22} ${CX + 6},${top - 22} C${CX + 36},${top - 22} ${CX + w + 8},${top - 6} ${CX + w + 3},${CY - 2} L${CX + w - 2},${CY - 24} C${CX + 26},${CY - 34} ${CX + 4},${CY - 40} ${CX - 16},${CY - 36} C${CX - 30},${CY - 32} ${CX - w + 2},${CY - 28} ${CX - w + 1},${CY - 2}Z`;
      return P(d, fill) + S(`M${CX - 20},${top - 10} C${CX - 4},${top - 18} ${CX + 16},${top - 18} ${CX + 30},${top - 8}`, hi, 2.4, 'opacity="0.4"');
    case 'buzz':
      d = `M${CX - w - 1},${CY - 8} C${CX - w - 4},${top - 4} ${CX - 30},${top - 12} ${CX},${top - 12} C${CX + 30},${top - 12} ${CX + w + 4},${top - 4} ${CX + w + 1},${CY - 8} L${CX + w - 1},${CY - 26} C${CX + 20},${CY - 38} ${CX - 20},${CY - 38} ${CX - w + 1},${CY - 26}Z`;
      return P(d, fill, 'opacity="0.92"');
    case 'spiky': {
      d = `M${CX - w - 6},${CY - 4}`;
      [[-62, -46], [-50, -86], [-28, -66], [-12, -98], [8, -70], [28, -94], [40, -64], [62, -72], [54, -34]].forEach(([dx, dy], i) => {
        d += ` Q${CX + dx + (i % 2 ? 10 : -10)},${CY + dy + 18} ${CX + dx},${CY + dy}`;
      });
      d += ` L${CX + w + 6},${CY - 4} L${CX + w - 2},${CY - 22} L${CX + 22},${CY - 14} L${CX + 14},${CY - 32} L${CX},${CY - 12} L${CX - 12},${CY - 32} L${CX - 24},${CY - 14} L${CX - w + 2},${CY - 22}Z`;
      return cast(d) + P(d, fill) + shine;
    }
    case 'mohawk':
      return P(`M${CX - 14},${CY - 40} C${CX - 18},${top - 54} ${CX + 18},${top - 54} ${CX + 14},${CY - 40}Z`, fill)
        + P(`M${CX - w - 1},${CY - 8} C${CX - w - 4},${top - 4} ${CX + w + 4},${top - 4} ${CX + w + 1},${CY - 8} L${CX + w - 1},${CY - 26} C${CX + 20},${CY - 38} ${CX - 20},${CY - 38} ${CX - w + 1},${CY - 26}Z`, shade, 'opacity="0.5"');
    case 'curly': {
      let out = '';
      [[-40, -30, 15], [-24, -44, 16], [-4, -50, 16], [16, -48, 16], [34, -38, 15], [-50, -12, 12], [50, -12, 12], [-10, -34, 11], [12, -32, 11]].forEach(([dx, dy, r]) => { out += C(CX + dx, CY + dy, r, fill) + C(CX + dx - r * 0.3, CY + dy - r * 0.35, r * 0.35, hi, 'opacity="0.25"'); });
      return out;
    }
    case 'afro':
      return P(`M${CX - w - 10},${CY - 10} C${CX - w - 16},${top - 30} ${CX + w + 16},${top - 30} ${CX + w + 10},${CY - 10} C${CX + 26},${CY - 30} ${CX - 26},${CY - 30} ${CX - w - 10},${CY - 10}Z`, fill)
        + C(CX - 22, top - 10, 12, hi, 'opacity="0.2"') + C(CX + 14, top - 16, 9, hi, 'opacity="0.16"');
    case 'veil': // hair falling over one side of the face
      d = `${crown} C${CX + w + 6},${CY + 24} ${CX + 34},${CY + 64} ${CX + 12},${CY + 76} C${CX + 6},${CY + 34} ${CX - 2},${CY - 6} ${CX - 22},${CY - 22} C${CX - 34},${CY - 18} ${CX - w},${CY - 8} ${CX - w - 7},${CY + 2}Z`;
      return cast(d) + P(d, fill) + S(`M${CX + 24},${CY - 40} C${CX + 30},${CY} ${CX + 26},${CY + 40} ${CX + 16},${CY + 66}`, shade, 1.6, 'opacity="0.55"') + frame;
    case 'tentacles':
      return P(`${crown} L${CX + w},${CY - 20} C${CX + 20},${CY - 30} ${CX - 20},${CY - 30} ${CX - w},${CY - 20}Z`, fill);
    default:
      d = locks([[CX + 28, CY - 12], [CX + 8, CY - 6], [CX - 12, CY - 8], [CX - 32, CY - 4]], CY - 30);
      return cast(d) + P(d, fill) + frame + shine;
  }
}

// ── accessories ───────────────────────────────────────────────────────────────
const W = (spec) => (spec.head || {}).w || 44;
const TOP = (spec) => CY - ((spec.head || {}).h || 60);

const ACC = {
  glasses: (s, a) => {
    const c = a.color || '#1d1d22', r = a.round ? 11 : 0;
    const lens = (x) => a.round ? C(x, CY + 6, 11, a.tint || '#ffffff', `opacity="${a.tint ? 0.55 : 0.12}" stroke="${c}" stroke-width="3"`)
      : `<rect x="${x - 13}" y="${CY - 3}" width="26" height="18" rx="5" fill="${a.tint || '#ffffff'}" opacity="${a.tint ? 0.75 : 0.12}" stroke="${c}" stroke-width="3"/>`;
    return lens(CX - 19) + lens(CX + 19) + S(`M${CX - 7},${CY + 4} C${CX - 3},${CY} ${CX + 3},${CY} ${CX + 7},${CY + 4}`, c, 2.6)
      + S(`M${CX - 32},${CY + 2} L${CX - W(s)},${CY}`, c, 2.6) + S(`M${CX + 32},${CY + 2} L${CX + W(s)},${CY}`, c, 2.6)
      + (a.tint ? P(`M${CX - 28},${CY + 2} L${CX - 18},${CY - 1} L${CX - 26},${CY + 10}Z`, '#ffffff', 'opacity="0.35"') + P(`M${CX + 10},${CY + 2} L${CX + 20},${CY - 1} L${CX + 12},${CY + 10}Z`, '#ffffff', 'opacity="0.35"') : '');
  },
  headphones: (s, a) => {
    const c = a.color || '#20232b', w = W(s), t = TOP(s);
    return S(`M${CX - w - 6},${CY} C${CX - w - 8},${t - 26} ${CX + w + 8},${t - 26} ${CX + w + 6},${CY}`, c, 8)
      + `<rect x="${CX - w - 16}" y="${CY - 14}" width="18" height="34" rx="8" fill="${c}"/><rect x="${CX + w - 2}" y="${CY - 14}" width="18" height="34" rx="8" fill="${c}"/>`
      + (a.accent ? `<rect x="${CX - w - 12}" y="${CY - 8}" width="5" height="22" rx="2.5" fill="${a.accent}"/><rect x="${CX + w + 7}" y="${CY - 8}" width="5" height="22" rx="2.5" fill="${a.accent}"/>` : '')
      + (a.mic ? S(`M${CX - w - 6},${CY + 14} C${CX - w + 2},${CY + 40} ${CX - 30},${CY + 42} ${CX - 16},${CY + 38}`, c, 3.5) + C(CX - 14, CY + 38, 4.5, c) : '');
  },
  catEars: (s, a) => {
    const c = a.color || s.hair.color, inner = a.inner || '#ffb8c8', t = TOP(s);
    const ear = (x, f) => P(`M${x - 18 * f},${t + 14} L${x + 4 * f},${t - 30} L${x + 22 * f},${t + 4}Z`, c) + P(`M${x - 10 * f},${t + 8} L${x + 4 * f},${t - 18} L${x + 14 * f},${t + 4}Z`, inner);
    return ear(CX - 30, -1 * -1) + ear(CX + 30, -1);
  },
  foxEars: (s, a) => {
    const c = a.color || s.hair.color, t = TOP(s);
    const ear = (x, f) => P(`M${x - 16 * f},${t + 18} C${x - 12 * f},${t - 10} ${x},${t - 36} ${x + 6 * f},${t - 44} C${x + 16 * f},${t - 20} ${x + 24 * f},${t} ${x + 20 * f},${t + 14}Z`, c) + P(`M${x - 6 * f},${t + 10} C${x - 4 * f},${t - 8} ${x + 2 * f},${t - 24} ${x + 6 * f},${t - 30} C${x + 12 * f},${t - 14} ${x + 14 * f},${t} ${x + 12 * f},${t + 8}Z`, '#fff1e2') + P(`M${x + 4 * f},${t - 36} L${x + 6 * f},${t - 44} L${x + 10 * f},${t - 34}Z`, '#ffffff');
    return ear(CX - 30, 1) + ear(CX + 30, -1);
  },
  horns: (s, a) => {
    const c = a.color || '#2a1a1a', t = TOP(s), hi = lighten(c, 0.35);
    const horn = (x, f) => P(`M${x},${t + 14} C${x - 4 * f},${t - 10} ${x - 22 * f},${t - 26} ${x - 34 * f},${t - 30} C${x - 22 * f},${t - 16} ${x - 14 * f},${t} ${x - 12 * f},${t + 18}Z`, c) + S(`M${x - 4 * f},${t + 2} C${x - 10 * f},${t - 12} ${x - 20 * f},${t - 20} ${x - 28 * f},${t - 26}`, hi, 1.6, 'opacity="0.6"');
    return horn(CX - 22, 1) + horn(CX + 22, -1);
  },
  ramHorns: (s, a) => {
    const c = a.color || '#d9cbb0';
    const horn = (x, f) => P(`M${x},${CY - 40} C${x - 40 * f},${CY - 76} ${x - 86 * f},${CY - 40} ${x - 70 * f},${CY + 4} C${x - 60 * f},${CY + 26} ${x - 36 * f},${CY + 18} ${x - 40 * f},${CY} C${x - 54 * f},${CY + 4} ${x - 58 * f},${CY - 30} ${x - 32 * f},${CY - 40}Z`, c, `stroke="${darken(c, 0.35)}" stroke-width="2"`)
      + S(`M${x - 50 * f},${CY - 52} L${x - 44 * f},${CY - 44} M${x - 64 * f},${CY - 40} L${x - 56 * f},${CY - 34} M${x - 70 * f},${CY - 20} L${x - 62 * f},${CY - 18}`, darken(c, 0.35), 2);
    return horn(CX - 24, 1) + horn(CX + 24, -1);
  },
  halo: (s, a) => E(CX, TOP(s) - 22, 38, 9, 'none', `stroke="${a.color || '#ffe27a'}" stroke-width="5" opacity="${a.opacity || 0.95}"`),
  tiara: (s, a) => { const t = TOP(s); return P(`M${CX - 26},${t + 2} L${CX - 18},${t - 12} L${CX - 8},${t - 2} L${CX},${t - 18} L${CX + 8},${t - 2} L${CX + 18},${t - 12} L${CX + 26},${t + 2} C${CX + 10},${t - 4} ${CX - 10},${t - 4} ${CX - 26},${t + 2}Z`, a.color || '#ffd75e') + C(CX, t - 8, 3.5, a.gem || '#ff4fa3'); },
  crown: (s, a) => { const t = TOP(s); return P(`M${CX - 30},${t + 4} L${CX - 34},${t - 26} L${CX - 16},${t - 10} L${CX},${t - 32} L${CX + 16},${t - 10} L${CX + 34},${t - 26} L${CX + 30},${t + 4}Z`, a.color || '#ffcc33') + C(CX, t - 8, 4, '#e8344a') + C(CX - 18, t - 4, 3, '#3a8bff') + C(CX + 18, t - 4, 3, '#3a8bff'); },
  ribbon: (s, a) => { const x = CX + (a.side || 1) * 30, y = TOP(s) + 6, c = a.color || '#ff4f8b'; return P(`M${x},${y} L${x - 18},${y - 12} L${x - 16},${y + 12}Z`, c) + P(`M${x},${y} L${x + 18},${y - 12} L${x + 16},${y + 12}Z`, c) + C(x, y, 5, darken(c, 0.2)); },
  starClip: (s, a) => star(CX + (a.side || 1) * 34, TOP(s) + 14, 4.5, a.color || '#ffe066'),
  earrings: (s, a) => { const w = W(s); return C(CX - w + 2, CY + 20, a.r || 3.5, a.color || '#ffd36b') + C(CX + w - 2, CY + 20, a.r || 3.5, a.color || '#ffd36b'); },
  hoops: (s, a) => { const w = W(s); return C(CX - w + 2, CY + 24, 7, 'none', `stroke="${a.color || '#ffd36b'}" stroke-width="2.4"`) + C(CX + w - 2, CY + 24, 7, 'none', `stroke="${a.color || '#ffd36b'}" stroke-width="2.4"`); },
  beard: (s, a) => { const c = a.color || s.hair.color, w = W(s); return P(`M${CX - w + 2},${CY + 8} C${CX - w + 4},${CY + 58} ${CX - 18},${CY + 76} ${CX},${CY + 78} C${CX + 18},${CY + 76} ${CX + w - 4},${CY + 58} ${CX + w - 2},${CY + 8} C${CX + 30},${CY + 30} ${CX + 20},${CY + 26} ${CX + 12},${CY + 30} C${CX + 6},${CY + 26} ${CX - 6},${CY + 26} ${CX - 12},${CY + 30} C${CX - 20},${CY + 26} ${CX - 30},${CY + 30} ${CX - w + 2},${CY + 8}Z`, c) + P(`M${CX - 12},${CY + 38} C${CX - 4},${CY + 34} ${CX + 4},${CY + 34} ${CX + 12},${CY + 38} C${CX + 6},${CY + 44} ${CX - 6},${CY + 44} ${CX - 12},${CY + 38}Z`, darken(c, 0.4)); },
  stubble: (s) => P(`M${CX - 38},${CY + 18} C${CX - 30},${CY + 56} ${CX + 30},${CY + 56} ${CX + 38},${CY + 18} C${CX + 20},${CY + 34} ${CX - 20},${CY + 34} ${CX - 38},${CY + 18}Z`, '#000000', 'opacity="0.13"'),
  mustache: (s, a) => P(`M${CX},${CY + 30} C${CX - 8},${CY + 24} ${CX - 22},${CY + 26} ${CX - 24},${CY + 36} C${CX - 16},${CY + 32} ${CX - 8},${CY + 34} ${CX},${CY + 33} C${CX + 8},${CY + 34} ${CX + 16},${CY + 32} ${CX + 24},${CY + 36} C${CX + 22},${CY + 26} ${CX + 8},${CY + 24} ${CX},${CY + 30}Z`, a.color || s.hair.color),
  freckles: (s) => [[-26, 18], [-20, 22], [-30, 24], [26, 18], [20, 22], [30, 24], [-24, 28], [24, 28]].map(([dx, dy]) => C(CX + dx, CY + dy, 1.3, '#9b5a3c', 'opacity="0.6"')).join(''),
  scar: (s) => S(`M${CX + 16},${CY - 16} L${CX + 28},${CY + 16}`, '#8e4a46', 2.4) + S(`M${CX + 18},${CY - 6} L${CX + 25},${CY - 9} M${CX + 21},${CY + 3} L${CX + 28},${CY}`, '#8e4a46', 1.6),
  warpaint: (s, a) => P(`M${CX - 40},${CY + 12} L${CX - 14},${CY + 10} L${CX - 16},${CY + 16} L${CX - 40},${CY + 18}Z`, a.color || '#c22b2b', 'opacity="0.85"') + P(`M${CX + 40},${CY + 12} L${CX + 14},${CY + 10} L${CX + 16},${CY + 16} L${CX + 40},${CY + 18}Z`, a.color || '#c22b2b', 'opacity="0.85"'),
  runes: (s, a) => { const c = a.color || '#c58bff'; return C(CX, CY - 22, 4, c) + S(`M${CX},${CY - 32} L${CX},${CY - 12} M${CX - 8},${CY - 22} L${CX + 8},${CY - 22}`, c, 1.6) + S(`M${CX - 30},${CY + 14} l4,8 l4,-8 M${CX + 22},${CY + 14} l4,8 l4,-8`, c, 1.6, 'opacity="0.8"'); },
  thirdEye: (s, a) => E(CX, CY - 22, 7, 4.5, '#ffffff') + C(CX, CY - 22, 3.2, a.color || '#a64bff') + C(CX, CY - 22, 1.4, '#000000'),
  cracks: (s) => S(`M${CX + 10},${CY - 50} L${CX + 4},${CY - 34} L${CX + 12},${CY - 24} L${CX + 6},${CY - 12}`, '#7a6a6a', 1.6) + S(`M${CX - 30},${CY + 30} L${CX - 22},${CY + 40} L${CX - 26},${CY + 50}`, '#7a6a6a', 1.4),
  dollCheeks: (s) => C(CX - 26, CY + 22, 7, '#f08a9c', 'opacity="0.7"') + C(CX + 26, CY + 22, 7, '#f08a9c', 'opacity="0.7"'),
  stitches: (s) => S(`M${CX - 40},${CY - 30} L${CX - 10},${CY - 40}`, '#3a2a2a', 2) + [-36, -28, -20, -12].map((dx, i) => S(`M${CX + dx},${CY - 42 + i * -0.4 + 2} l2,8`, '#3a2a2a', 1.6)).join('') + S(`M${CX + 18},${CY + 30} L${CX + 34},${CY + 6}`, '#3a2a2a', 2),
  veins: (s, a) => S(`M${CX - 40},${CY - 20} L${CX - 30},${CY - 4} L${CX - 36},${CY + 10} M${CX + 40},${CY - 26} L${CX + 32},${CY - 8} L${CX + 38},${CY + 8} M${CX - 18},${CY + 46} L${CX - 10},${CY + 36}`, a.color || '#3b1652', 1.8, 'opacity="0.7"'),
  tear: (s) => P(`M${CX - 22},${CY + 14} C${CX - 25},${CY + 20} ${CX - 25},${CY + 24} ${CX - 22},${CY + 26} C${CX - 19},${CY + 24} ${CX - 19},${CY + 20} ${CX - 22},${CY + 14}Z`, '#9fd6ff'),
  clownPaint: (s) => P(`M${CX - 19},${CY - 10} L${CX - 14},${CY + 6} L${CX - 19},${CY + 22} L${CX - 24},${CY + 6}Z`, '#2a6cff', 'opacity="0.8"') + P(`M${CX + 19},${CY - 10} L${CX + 24},${CY + 6} L${CX + 19},${CY + 22} L${CX + 14},${CY + 6}Z`, '#2a6cff', 'opacity="0.8"') + P(`M${CX - 16},${CY + 34} C${CX - 8},${CY + 52} ${CX + 8},${CY + 52} ${CX + 16},${CY + 34} C${CX + 8},${CY + 42} ${CX - 8},${CY + 42} ${CX - 16},${CY + 34}Z`, '#e0262b', 'opacity="0.9"'),
  policeCap: (s, a) => { const t = TOP(s), c = a.color || '#1f2d4a'; return P(`M${CX - 50},${t + 26} C${CX - 54},${t - 6} ${CX - 30},${t - 22} ${CX},${t - 22} C${CX + 30},${t - 22} ${CX + 54},${t - 6} ${CX + 50},${t + 26}Z`, c) + P(`M${CX - 50},${t + 22} L${CX + 50},${t + 22} L${CX + 48},${t + 32} L${CX - 48},${t + 32}Z`, '#111318') + P(`M${CX - 44},${t + 30} C${CX - 20},${t + 46} ${CX + 20},${t + 46} ${CX + 44},${t + 30}Z`, '#0b0c10') + star(CX, t + 4, 4, '#ffd36b'); },
  beanie: (s, a) => { const t = TOP(s), c = a.color || '#2b2b2b'; return P(`M${CX - 50},${t + 30} C${CX - 54},${t - 20} ${CX + 54},${t - 20} ${CX + 50},${t + 30}Z`, c) + `<rect x="${CX - 52}" y="${t + 18}" width="104" height="16" rx="6" fill="${darken(c, 0.2)}"/>`; },
  balaclava: (s, a) => { const c = a.color || '#1e1e1e', w = W(s), t = TOP(s); return P(`M${CX - w - 6},${CY + 40} C${CX - w - 10},${t - 10} ${CX - 30},${t - 16} ${CX},${t - 16} C${CX + 30},${t - 16} ${CX + w + 10},${t - 10} ${CX + w + 6},${CY + 40} L${CX + w + 6},${CY + 70} L${CX - w - 6},${CY + 70}Z M${CX - 36},${CY - 6} C${CX - 36},${CY + 18} ${CX + 36},${CY + 18} ${CX + 36},${CY - 6} C${CX + 36},${CY - 16} ${CX - 36},${CY - 16} ${CX - 36},${CY - 6}Z`, c, 'fill-rule="evenodd"'); },
  bandana: (s, a) => { const c = a.color || '#b0332e', w = W(s); return P(`M${CX - w - 2},${CY + 16} L${CX + w + 2},${CY + 16} L${CX + w - 4},${CY + 44} C${CX + 20},${CY + 70} ${CX - 20},${CY + 70} ${CX - w + 4},${CY + 44}Z`, c) + [-20, 0, 20].map((dx) => C(CX + dx, CY + 38, 3, '#ffffff', 'opacity="0.6"')).join(''); },
  helmet: (s, a) => { const c = a.color || '#3e4a3a', w = W(s), t = TOP(s); return P(`M${CX - w - 10},${CY + 6} C${CX - w - 14},${t - 22} ${CX + w + 14},${t - 22} ${CX + w + 10},${CY + 6} L${CX + w + 2},${CY + 6} C${CX + w},${CY - 14} ${CX + 30},${CY - 22} ${CX},${CY - 22} C${CX - 30},${CY - 22} ${CX - w},${CY - 14} ${CX - w - 2},${CY + 6}Z`, c) + S(`M${CX - w - 6},${CY - 12} C${CX - 20},${CY - 26} ${CX + 20},${CY - 26} ${CX + w + 6},${CY - 12}`, darken(c, 0.3), 3) + (a.goggles ? `<rect x="${CX - 40}" y="${t + 2}" width="80" height="20" rx="10" fill="#1a1e22"/><rect x="${CX - 34}" y="${t + 5}" width="30" height="14" rx="7" fill="${a.goggles}" opacity="0.85"/><rect x="${CX + 4}" y="${t + 5}" width="30" height="14" rx="7" fill="${a.goggles}" opacity="0.85"/>` : ''); },
  gasMask: (s, a) => { const c = a.color || '#2c332c'; return P(`M${CX - 30},${CY + 14} C${CX - 30},${CY + 54} ${CX + 30},${CY + 54} ${CX + 30},${CY + 14} C${CX + 20},${CY + 6} ${CX - 20},${CY + 6} ${CX - 30},${CY + 14}Z`, c) + C(CX, CY + 40, 11, darken(c, 0.25)) + C(CX, CY + 40, 7, '#111') + S(`M${CX - 6},${CY + 40} L${CX + 6},${CY + 40} M${CX},${CY + 34} L${CX},${CY + 46}`, '#444', 2) + C(CX - 26, CY + 34, 7, darken(c, 0.2)) + C(CX + 26, CY + 34, 7, darken(c, 0.2)); },
  visor: (s, a) => { const c = a.color || '#00e5ff'; return `<rect x="${CX - 48}" y="${CY - 6}" width="96" height="22" rx="11" fill="#101420"/>` + `<rect x="${CX - 42}" y="${CY - 1}" width="84" height="12" rx="6" fill="${c}" opacity="0.9"/>` + `<rect x="${CX - 40}" y="${CY}" width="40" height="3" rx="1.5" fill="#ffffff" opacity="0.6"/>`; },
  headset: (s, a) => { const c = a.color || '#1f2329', w = W(s); return S(`M${CX + w},${CY} C${CX + w + 4},${CY - 50} ${CX - w - 4},${CY - 50} ${CX - w},${CY}`, c, 4) + `<rect x="${CX + w - 6}" y="${CY - 8}" width="14" height="24" rx="6" fill="${c}"/>` + S(`M${CX + w},${CY + 12} C${CX + w - 4},${CY + 40} ${CX + 20},${CY + 42} ${CX + 12},${CY + 40}`, c, 2.6) + C(CX + 11, CY + 40, 3.5, c); },
  hood: () => '', // drawn as back/front layers in spec.hood
  mic: (s, a) => { const c = a.color || '#2a2d35'; return `<g transform="rotate(-18 ${CX + 40} ${CY + 70})"><rect x="${CX + 34}" y="${CY + 50}" width="12" height="44" rx="5" fill="${c}"/><rect x="${CX + 30}" y="${CY + 30}" width="20" height="28" rx="10" fill="${lighten(c, 0.35)}"/>${S(`M${CX + 32},${CY + 38} H${CX + 48} M${CX + 32},${CY + 44} H${CX + 48} M${CX + 32},${CY + 50} H${CX + 48}`, darken(c, 0.2), 1.5)}</g>`; },
  megaphone: () => `<g transform="rotate(-10 ${CX + 20} ${CY + 40})"><path d="M${CX + 6},${CY + 30} L${CX + 66},${CY + 6} L${CX + 66},${CY + 74} L${CX + 6},${CY + 50}Z" fill="#ffffff"/><path d="M${CX + 6},${CY + 30} L${CX + 66},${CY + 6} L${CX + 66},${CY + 20} L${CX + 6},${CY + 36}Z" fill="#e8462f"/><path d="M${CX + 6},${CY + 50} L${CX + 66},${CY + 74} L${CX + 66},${CY + 60} L${CX + 6},${CY + 44}Z" fill="#e8462f"/><ellipse cx="${CX + 66}" cy="${CY + 40}" rx="8" ry="34" fill="#d8d8de"/><rect x="${CX - 6}" y="${CY + 32}" width="14" height="16" rx="3" fill="#333"/><rect x="${CX + 20}" y="${CY + 52}" width="9" height="24" rx="3" fill="#333"/></g>`,
  phone: () => `<g transform="rotate(-24 ${CX + 50} ${CY + 30})"><path d="M${CX + 44},${CY - 14} C${CX + 30},${CY - 14} ${CX + 26},${CY + 2} ${CX + 34},${CY + 6} L${CX + 46},${CY + 4} C${CX + 48},${CY + 20} ${CX + 48},${CY + 40} ${CX + 46},${CY + 56} L${CX + 34},${CY + 54} C${CX + 26},${CY + 58} ${CX + 30},${CY + 74} ${CX + 44},${CY + 74} C${CX + 62},${CY + 74} ${CX + 66},${CY + 40} ${CX + 62},${CY + 20} C${CX + 60},${CY} ${CX + 56},${CY - 14} ${CX + 44},${CY - 14}Z" fill="#26272c"/><path d="M${CX + 56},${CY - 6} C${CX + 60},${CY + 10} ${CX + 61},${CY + 30} ${CX + 58},${CY + 52}" stroke="#ffffff" stroke-width="2" opacity="0.25" fill="none"/></g>`,
  walkie: () => `<g transform="rotate(-8 ${CX + 50} ${CY + 40})"><rect x="${CX + 34}" y="${CY + 10}" width="28" height="56" rx="6" fill="#2f3a2a"/><rect x="${CX + 52}" y="${CY - 22}" width="6" height="34" rx="2" fill="#1d2419"/><rect x="${CX + 39}" y="${CY + 18}" width="18" height="12" rx="2" fill="#a9d36b"/>${[0, 1, 2, 3].map((i) => `<rect x="${CX + 39}" y="${CY + 36 + i * 6}" width="18" height="2.5" rx="1" fill="#1d2419"/>`).join('')}</g>`,
  candle: () => `<rect x="${CX + 52}" y="${CY + 50}" width="14" height="40" rx="3" fill="#f2ead8"/><path d="M${CX + 59},${CY + 26} C${CX + 52},${CY + 38} ${CX + 54},${CY + 48} ${CX + 59},${CY + 48} C${CX + 64},${CY + 48} ${CX + 66},${CY + 38} ${CX + 59},${CY + 26}Z" fill="#ffc94a"/><circle cx="${CX + 59}" cy="${CY + 42}" r="14" fill="#ffcf6b" opacity="0.25"/>`,
  cross: () => `<rect x="${CX - 3}" y="${CY + 92}" width="6" height="24" rx="1" fill="#e8c96b"/><rect x="${CX - 10}" y="${CY + 98}" width="20" height="6" rx="1" fill="#e8c96b"/>`,
  book: () => `<g transform="rotate(-6 ${CX} ${CY + 110})"><path d="M${CX - 52},${CY + 92} C${CX - 30},${CY + 84} ${CX - 8},${CY + 86} ${CX},${CY + 94} C${CX + 8},${CY + 86} ${CX + 30},${CY + 84} ${CX + 52},${CY + 92} L${CX + 52},${CY + 140} L${CX - 52},${CY + 140}Z" fill="#7a3e22"/><path d="M${CX - 46},${CY + 94} C${CX - 28},${CY + 88} ${CX - 8},${CY + 90} ${CX - 2},${CY + 96} L${CX - 2},${CY + 140} L${CX - 46},${CY + 140}Z" fill="#f4ecd8"/><path d="M${CX + 46},${CY + 94} C${CX + 28},${CY + 88} ${CX + 8},${CY + 90} ${CX + 2},${CY + 96} L${CX + 2},${CY + 140} L${CX + 46},${CY + 140}Z" fill="#efe5cc"/></g>`,
  finger: (s) => `<g stroke="${darken(s.skinTone, 0.35)}" stroke-width="1.6"><path d="M${CX - 16},${CY + 60} C${CX - 16},${CY + 48} ${CX + 18},${CY + 48} ${CX + 18},${CY + 60} L${CX + 20},${CY + 86} L${CX - 18},${CY + 86}Z" fill="${lighten(s.skinTone, 0.04)}"/><path d="M${CX - 5},${CY + 58} L${CX - 5},${CY + 26} C${CX - 5},${CY + 19} ${CX + 7},${CY + 19} ${CX + 7},${CY + 26} L${CX + 7},${CY + 58}Z" fill="${lighten(s.skinTone, 0.06)}"/></g><path d="M${CX - 2},${CY + 22} C${CX},${CY + 20} ${CX + 4},${CY + 20} ${CX + 5},${CY + 23}" stroke="#ffffff" stroke-width="1.4" opacity="0.5" fill="none"/><path d="M${CX - 3},${CY + 31} C${CX - 2},${CY + 28} ${CX + 4},${CY + 28} ${CX + 5},${CY + 31}" stroke="${skinShadow(s.skinTone)}" stroke-width="1.5" fill="none"/>`,
  sparkles: (s, a) => (a.points || [[44, 64], [206, 74], [200, 170]]).map(([x, y], i) => star(x, y, 4 + (i % 2) * 2, a.color || '#ffffff')).join(''),
  notes: () => note(204, 70, '#ffffff', 0.9) + note(40, 84, '#ffffff', 0.75),
  waves: (s, a) => [16, 28, 40].map((r, i) => S(`M${CX + 46 + r * 0.2},${CY + 36 - r * 0.8} C${CX + 52 + r},${CY + 36 - r * 0.4} ${CX + 52 + r},${CY + 36 + r * 0.4} ${CX + 46 + r * 0.2},${CY + 36 + r * 0.8}`, a.color || '#ffffff', 3, `opacity="${0.8 - i * 0.2}"`)).join(''),
  bubbles: () => [[CX + 36, CY - 10, 5], [CX + 46, CY - 30, 7], [CX + 40, CY - 56, 4]].map(([x, y, r]) => C(x, y, r, 'none', 'stroke="#ffffff" stroke-width="2" opacity="0.7"')).join(''),
  bone: () => `<g transform="rotate(-30 ${CX - 60} ${CY + 100})"><rect x="${CX - 90}" y="${CY + 94}" width="60" height="10" rx="5" fill="#efe6d2"/><circle cx="${CX - 90}" cy="${CY + 94}" r="7" fill="#efe6d2"/><circle cx="${CX - 90}" cy="${CY + 104}" r="7" fill="#efe6d2"/><circle cx="${CX - 30}" cy="${CY + 94}" r="7" fill="#efe6d2"/><circle cx="${CX - 30}" cy="${CY + 104}" r="7" fill="#efe6d2"/></g>`,
  leafCrown: (s) => { const t = TOP(s); return [-36, -18, 0, 18, 36].map((dx, i) => leaf(CX + dx, t + 4 - (i === 2 ? 8 : 0), dx * 1.2, '#5fbf54', 1)).join('') + C(CX - 26, t + 8, 3.5, '#ffd86b') + C(CX + 26, t + 8, 3.5, '#ff8fb1'); },
  balloon: () => `<path d="M${CX + 62},${CY + 40} C${CX + 58},${CY + 70} ${CX + 70},${CY + 90} ${CX + 62},${CY + 120}" stroke="#ffffff" stroke-width="1.5" fill="none" opacity="0.8"/><ellipse cx="${CX + 64}" cy="${CY + 8}" rx="24" ry="30" fill="#ff3d8b"/><ellipse cx="${CX + 56}" cy="${CY - 6}" rx="6" ry="10" fill="#ffffff" opacity="0.4"/><path d="M${CX + 60},${CY + 37} L${CX + 68},${CY + 37} L${CX + 64},${CY + 43}Z" fill="#d42d74"/>`,
  pacifier: () => `<circle cx="${CX}" cy="${CY + 40}" r="10" fill="#7fd1ff" stroke="#ffffff" stroke-width="2"/><circle cx="${CX}" cy="${CY + 40}" r="4" fill="#ffffff"/>`,
  cheekPuff: (s) => E(CX - 30, CY + 26, 14, 10, s.skinTone) + E(CX + 30, CY + 26, 14, 10, s.skinTone) + E(CX - 30, CY + 26, 6, 3, '#ff8a8a', 'opacity="0.5"') + E(CX + 30, CY + 26, 6, 3, '#ff8a8a', 'opacity="0.5"'),
  teeth: () => `<rect x="${CX - 8}" y="${CY + 36}" width="7.5" height="10" rx="1.5" fill="#ffffff" stroke="#c9b9a6"/><rect x="${CX + 0.5}" y="${CY + 36}" width="7.5" height="10" rx="1.5" fill="#ffffff" stroke="#c9b9a6"/>`,
  tusks: () => P(`M${CX - 16},${CY + 42} C${CX - 20},${CY + 30} ${CX - 18},${CY + 22} ${CX - 12},${CY + 18} C${CX - 12},${CY + 28} ${CX - 10},${CY + 34} ${CX - 8},${CY + 40}Z`, '#f2ebd6') + P(`M${CX + 16},${CY + 42} C${CX + 20},${CY + 30} ${CX + 18},${CY + 22} ${CX + 12},${CY + 18} C${CX + 12},${CY + 28} ${CX + 10},${CY + 34} ${CX + 8},${CY + 40}Z`, '#f2ebd6'),
  glitch: (s, a) => `<rect x="20" y="${CY - 8}" width="216" height="10" fill="${a.c1 || '#ff2b6d'}" opacity="0.55"/><rect x="0" y="${CY + 30}" width="180" height="7" fill="${a.c2 || '#20e3ff'}" opacity="0.5"/><rect x="60" y="${CY - 40}" width="196" height="5" fill="#ffffff" opacity="0.35"/>`,
  wings: (s, a) => { const c = a.color || '#1b1222'; const wing = (f) => P(`M${CX + f * 40},${CY + 80} C${CX + f * 70},${CY + 20} ${CX + f * 110},${CY - 40} ${CX + f * 126},${CY - 70} C${CX + f * 112},${CY - 30} ${CX + f * 120},${CY - 10} ${CX + f * 128},${CY + 4} C${CX + f * 110},${CY + 4} ${CX + f * 108},${CY + 26} ${CX + f * 122},${CY + 40} C${CX + f * 100},${CY + 40} ${CX + f * 98},${CY + 60} ${CX + f * 108},${CY + 76} C${CX + f * 86},${CY + 76} ${CX + f * 70},${CY + 86} ${CX + f * 60},${CY + 100}Z`, c); return wing(-1) + wing(1); },
  diveHelmet: () => '',
  bowtie: () => P(`M${CX},${CY + 92} L${CX - 16},${CY + 84} L${CX - 16},${CY + 100}Z`, '#d0283e') + P(`M${CX},${CY + 92} L${CX + 16},${CY + 84} L${CX + 16},${CY + 100}Z`, '#d0283e') + C(CX, CY + 92, 4, '#a01d30'),
  collarFrill: () => [-60, -40, -20, 0, 20, 40, 60].map((dx) => C(CX + dx, CY + 86, 13, dx % 40 === 0 ? '#ffffff' : '#ffd23f')).join(''),
};

// ── special heads (non-human builds) ──────────────────────────────────────────
const SPECIAL = {
  robot: (s, defs) => {
    const m = s.metal || '#aeb6c2', led = s.led || '#00e5ff';
    const g = id('mt');
    defs.push(`<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(m, 0.35)}"/><stop offset="1" stop-color="${darken(m, 0.35)}"/></linearGradient>`);
    return `<rect x="112" y="150" width="32" height="52" fill="${darken(m, 0.4)}"/>`
      + S(`M${CX},${CY - 62} L${CX},${CY - 84}`, darken(m, 0.3), 4) + C(CX, CY - 88, 6, led)
      + `<rect x="${CX - 52}" y="${CY - 62}" width="104" height="112" rx="28" fill="url(#${g})"/>`
      + `<rect x="${CX - 60}" y="${CY - 14}" width="12" height="30" rx="5" fill="${darken(m, 0.25)}"/><rect x="${CX + 48}" y="${CY - 14}" width="12" height="30" rx="5" fill="${darken(m, 0.25)}"/>`
      + `<rect x="${CX - 40}" y="${CY - 26}" width="80" height="40" rx="18" fill="#0e1420"/>`
      + E(CX - 17, CY - 6, 9, 9, led, 'opacity="0.95"') + E(CX + 17, CY - 6, 9, 9, led, 'opacity="0.95"')
      + C(CX - 20, CY - 9, 2.6, '#ffffff', 'opacity="0.8"') + C(CX + 14, CY - 9, 2.6, '#ffffff', 'opacity="0.8"')
      + [-16, -8, 0, 8, 16].map((dx) => `<rect x="${CX + dx - 2.5}" y="${CY + 26}" width="5" height="10" rx="2" fill="${darken(m, 0.45)}"/>`).join('')
      + C(CX - 40, CY - 48, 3, darken(m, 0.3)) + C(CX + 40, CY - 48, 3, darken(m, 0.3)) + C(CX - 40, CY + 38, 3, darken(m, 0.3)) + C(CX + 40, CY + 38, 3, darken(m, 0.3))
      + P(`M${CX - 46},${CY - 50} C${CX - 30},${CY - 58} ${CX - 10},${CY - 58} ${CX},${CY - 56}`, 'none', 'stroke="#ffffff" stroke-width="3" opacity="0.4"');
  },
  alien: (s) => {
    const sk = s.skinTone;
    return P(`M${CX - 56},${CY - 20} C${CX - 60},${CY - 80} ${CX + 60},${CY - 80} ${CX + 56},${CY - 20} C${CX + 52},${CY + 20} ${CX + 20},${CY + 60} ${CX},${CY + 62} C${CX - 20},${CY + 60} ${CX - 52},${CY + 20} ${CX - 56},${CY - 20}Z`, sk)
      + P(`M${CX + 20},${CY - 66} C${CX + 56},${CY - 50} ${CX + 58},${CY + 10} ${CX + 10},${CY + 60} L${CX + 60},${CY + 60} L${CX + 60},${CY - 66}Z`, skinShadow(sk), 'opacity="0.45"')
      + P(`M${CX - 46},${CY - 6} C${CX - 44},${CY - 26} ${CX - 22},${CY - 22} ${CX - 8},${CY - 2} C${CX - 10},${CY + 18} ${CX - 40},${CY + 16} ${CX - 46},${CY - 6}Z`, '#07090c')
      + P(`M${CX + 46},${CY - 6} C${CX + 44},${CY - 26} ${CX + 22},${CY - 22} ${CX + 8},${CY - 2} C${CX + 10},${CY + 18} ${CX + 40},${CY + 16} ${CX + 46},${CY - 6}Z`, '#07090c')
      + E(CX - 34, CY - 8, 4, 2.5, '#ffffff', 'opacity="0.8"') + E(CX + 22, CY - 8, 4, 2.5, '#ffffff', 'opacity="0.8"')
      + S(`M${CX - 6},${CY + 40} C${CX - 2},${CY + 43} ${CX + 2},${CY + 43} ${CX + 6},${CY + 40}`, darken(sk, 0.4), 2.2)
      + E(CX - 20, CY - 54, 14, 6, '#ffffff', 'opacity="0.18"');
  },
  skull: (s) => {
    const b = '#efe6d2';
    return SPECIAL._ram(s) + P(`M${CX - 44},${CY - 30} C${CX - 46},${CY - 76} ${CX + 46},${CY - 76} ${CX + 44},${CY - 30} C${CX + 42},${CY + 2} ${CX + 26},${CY + 14} ${CX + 20},${CY + 40} C${CX + 18},${CY + 64} ${CX + 8},${CY + 76} ${CX},${CY + 78} C${CX - 8},${CY + 76} ${CX - 18},${CY + 64} ${CX - 20},${CY + 40} C${CX - 26},${CY + 14} ${CX - 42},${CY + 2} ${CX - 44},${CY - 30}Z`, b)
      + P(`M${CX + 10},${CY - 70} C${CX + 44},${CY - 60} ${CX + 44},${CY - 10} ${CX + 22},${CY + 30} C${CX + 18},${CY + 60} ${CX + 8},${CY + 74} ${CX},${CY + 78} L${CX + 50},${CY + 78} L${CX + 50},${CY - 70}Z`, '#000000', 'opacity="0.12"')
      + P(`M${CX - 34},${CY - 18} C${CX - 30},${CY - 34} ${CX - 12},${CY - 30} ${CX - 8},${CY - 14} C${CX - 10},${CY - 2} ${CX - 30},${CY} ${CX - 34},${CY - 18}Z`, '#170c08') + P(`M${CX + 34},${CY - 18} C${CX + 30},${CY - 34} ${CX + 12},${CY - 30} ${CX + 8},${CY - 14} C${CX + 10},${CY - 2} ${CX + 30},${CY} ${CX + 34},${CY - 18}Z`, '#170c08')
      + C(CX - 20, CY - 16, 3.4, '#ff3b2f') + C(CX + 20, CY - 16, 3.4, '#ff3b2f')
      + P(`M${CX - 6},${CY + 12} L${CX + 6},${CY + 12} L${CX},${CY + 28}Z`, '#170c08')
      + S(`M${CX - 10},${CY + 52} L${CX + 10},${CY + 52} M${CX - 8},${CY + 60} L${CX + 8},${CY + 60}`, '#8a7a62', 1.6);
  },
  _ram: (s) => ACC.ramHorns(s, { color: '#cdbb98' }),
  ghost: (s) => {
    const c = '#eef1ff';
    return P(`M${CX - 62},256 L${CX - 62},${CY - 4} C${CX - 62},${CY - 78} ${CX + 62},${CY - 78} ${CX + 62},${CY - 4} L${CX + 62},256Z`, c)
      + P(`M${CX + 20},${CY - 66} C${CX + 62},${CY - 50} ${CX + 62},${CY} ${CX + 62},256 L${CX + 40},256 C${CX + 46},${CY + 40} ${CX + 44},${CY - 30} ${CX + 20},${CY - 66}Z`, '#b8bfe8', 'opacity="0.6"')
      + E(CX - 20, CY, 10, 15, '#1c1f33') + E(CX + 20, CY, 10, 15, '#1c1f33') + C(CX - 23, CY - 5, 3, '#ffffff') + C(CX + 17, CY - 5, 3, '#ffffff')
      + E(CX, CY + 34, 9, 12, '#1c1f33');
  },
  pixel: (s) => {
    // 16x16 pixel portrait.
    const map = [
      '................', '.....######.....', '....########....', '...##########...', '...#SSSSSSSS#...', '...SSSSSSSSSS...',
      '...SEESSSSEESS..', '...SEESSSSEESS..', '...SSSSSSSSSS...', '...SSSSNNSSSS...', '....SSMMMMSS....', '.....SSSSSS.....',
      '......SSSS......', '....CCCCCCCC....', '..CCCCCCCCCCCC..', '.CCCCCCCCCCCCCC.'];
    const col = { '#': '#3b2414', S: '#f0b98d', E: '#13202b', N: '#d4936a', M: '#b63c4c', C: '#14a44d' };
    let out = '';
    const px = 11, ox = CX - 8 * px, oy = 46;
    map.forEach((row, y) => row.split('').forEach((ch, x) => { if (col[ch]) out += `<rect x="${ox + x * px}" y="${oy + y * px}" width="${px + 0.5}" height="${px + 0.5}" fill="${col[ch]}"/>`; }));
    return out;
  },
  astronaut: (s, defs) => SPECIAL._human(s, defs) + `<circle cx="${CX}" cy="${CY + 4}" r="74" fill="#bfe6ff" opacity="0.18" stroke="#eef6ff" stroke-width="7"/>`
    + P(`M${CX - 50},${CY - 40} C${CX - 30},${CY - 64} ${CX},${CY - 70} ${CX + 20},${CY - 66}`, 'none', 'stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity="0.55"')
    + `<rect x="${CX - 22}" y="${CY + 76}" width="44" height="14" rx="4" fill="#d9e2ec"/>`,
  diver: (s, defs) => {
    const brass = '#c99a3b';
    return `<circle cx="${CX}" cy="${CY + 4}" r="78" fill="${brass}"/>` + `<circle cx="${CX}" cy="${CY + 4}" r="78" fill="none" stroke="${darken(brass, 0.3)}" stroke-width="4"/>`
      + C(CX, CY + 8, 50, '#0d2a40') + G(SPECIAL._face(s, defs), `transform="translate(${CX} ${CY + 8}) scale(0.78) translate(${-CX} ${-(CY + 8)})"`) + C(CX, CY + 8, 50, '#7fd4ff', 'opacity="0.18"')
      + C(CX, CY + 8, 50, 'none', `stroke="${lighten(brass, 0.3)}" stroke-width="7"`)
      + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = i * Math.PI / 4; return C(CX + Math.cos(a) * 58, CY + 8 + Math.sin(a) * 58, 3.4, darken(brass, 0.35)); }).join('')
      + P(`M${CX - 40},${CY - 52} C${CX - 20},${CY - 66} ${CX + 10},${CY - 70} ${CX + 30},${CY - 62}`, 'none', 'stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity="0.4"');
  },
  twin: (s, defs) => {
    // Two overlapping faces: back one tinted.
    const back = G(SPECIAL._face({ ...s, skinTone: s.skin2 || darken(s.skinTone, 0.12), hair: s.hair2 || s.hair }, defs), `transform="translate(-30 -8) scale(0.92)" opacity="0.85"`);
    return back + G(SPECIAL._face(s, defs), 'transform="translate(18 6)"');
  },
  _face: (s, defs) => hairBack(s, defs) + neck(s) + ears(s) + P(headPath(s.head), s.skinTone) + headShadeLayer(s, defs) + cheeks(s) + eyes(s, defs) + brows(s) + nose(s) + mouth(s) + hairFront(s, defs),
  _human: (s, defs) => SPECIAL._face(s, defs),
  symbiote: (s) => {
    const c = '#121216';
    return P(`M${CX - 52},${CY - 10} C${CX - 54},${CY - 80} ${CX + 54},${CY - 80} ${CX + 52},${CY - 10} C${CX + 50},${CY + 40} ${CX + 26},${CY + 70} ${CX},${CY + 72} C${CX - 26},${CY + 70} ${CX - 50},${CY + 40} ${CX - 52},${CY - 10}Z`, c)
      + P(`M${CX - 46},${CY - 24} C${CX - 40},${CY - 52} ${CX - 14},${CY - 40} ${CX - 8},${CY - 8} C${CX - 22},${CY - 4} ${CX - 40},${CY - 6} ${CX - 46},${CY - 24}Z`, '#f4f4f4') + P(`M${CX + 46},${CY - 24} C${CX + 40},${CY - 52} ${CX + 14},${CY - 40} ${CX + 8},${CY - 8} C${CX + 22},${CY - 4} ${CX + 40},${CY - 6} ${CX + 46},${CY - 24}Z`, '#f4f4f4')
      + P(`M${CX - 38},${CY + 18} C${CX - 20},${CY + 54} ${CX + 20},${CY + 54} ${CX + 38},${CY + 18} C${CX + 20},${CY + 30} ${CX - 20},${CY + 30} ${CX - 38},${CY + 18}Z`, '#2a0a10')
      + P([-32, -22, -12, -2, 8, 18, 28].map((dx) => `M${CX + dx},${CY + 24} L${CX + dx + 4},${CY + 36} L${CX + dx + 8},${CY + 25}`).join(' '), '#f4f4f4')
      + P([-26, -14, -2, 10, 22].map((dx) => `M${CX + dx},${CY + 46} L${CX + dx + 4},${CY + 36} L${CX + dx + 8},${CY + 45}`).join(' '), '#f4f4f4')
      + E(CX - 16, CY - 56, 18, 7, '#ffffff', 'opacity="0.12"');
  },
  chipmunk: (s) => {
    const fur = '#c4773a', light = '#f3d7b2';
    return C(CX - 50, CY - 54, 16, fur) + C(CX + 50, CY - 54, 16, fur) + C(CX - 50, CY - 54, 8, '#f0a9a0') + C(CX + 50, CY - 54, 8, '#f0a9a0')
      + E(CX, CY + 4, 62, 66, fur) + E(CX - 34, CY + 26, 26, 22, light) + E(CX + 34, CY + 26, 26, 22, light) + E(CX, CY + 30, 22, 26, light)
      + P(`M${CX - 4},${CY - 64} L${CX + 4},${CY - 64} L${CX + 3},${CY - 18} L${CX - 3},${CY - 18}Z`, '#3a1f0c') + P(`M${CX - 22},${CY - 58} L${CX - 16},${CY - 58} L${CX - 18},${CY - 24} Z`, '#3a1f0c', 'opacity="0.7"') + P(`M${CX + 22},${CY - 58} L${CX + 16},${CY - 58} L${CX + 18},${CY - 24} Z`, '#3a1f0c', 'opacity="0.7"')
      + C(CX - 22, CY - 2, 8, '#140a06') + C(CX + 22, CY - 2, 8, '#140a06') + C(CX - 25, CY - 5, 2.6, '#ffffff') + C(CX + 19, CY - 5, 2.6, '#ffffff')
      + E(CX, CY + 18, 6, 4.5, '#3a1f0c') + S(`M${CX},${CY + 22} L${CX},${CY + 28} M${CX - 8},${CY + 30} C${CX - 4},${CY + 34} ${CX},${CY + 32} ${CX},${CY + 28} C${CX},${CY + 32} ${CX + 4},${CY + 34} ${CX + 8},${CY + 30}`, '#3a1f0c', 2)
      + `<rect x="${CX - 6}" y="${CY + 31}" width="5.5" height="9" rx="1.5" fill="#ffffff"/><rect x="${CX + 0.5}" y="${CY + 31}" width="5.5" height="9" rx="1.5" fill="#ffffff"/>`;
  },
  cosmic: (s, defs) => {
    const sk = s.skinTone;
    let out = hairBack(s, defs) + P(headPath({ w: 46, h: 64, chin: 58, jaw: 0.5 }), sk) + headShadeLayer({ ...s, head: { w: 46, chin: 58 } }, defs);
    [[-20, -2, 7], [20, -2, 7], [0, -26, 6], [-32, -24, 4], [32, -24, 4], [-12, 20, 3.5], [12, 20, 3.5]].forEach(([dx, dy, r]) => { out += E(CX + dx, CY + dy, r * 1.3, r, '#e9fff7') + C(CX + dx, CY + dy, r * 0.6, '#16d4a0') + C(CX + dx, CY + dy, r * 0.25, '#00110b'); });
    return out + S(`M${CX - 10},${CY + 40} C${CX - 4},${CY + 36} ${CX + 4},${CY + 36} ${CX + 10},${CY + 40}`, darken(sk, 0.5), 2) + hairFront(s, defs);
  },
};

function headShadeLayer(spec, defs) {
  const cp = id('hc');
  defs.push(`<clipPath id="${cp}"><path d="${headPath(spec.head)}"/></clipPath>`);
  const sh = skinShadow(spec.skinTone);
  return `<g clip-path="url(#${cp})">${P(headShade(spec.head || {}), sh, 'opacity="0.55"')}`
    + E(CX - 16, CY - 34, 20, 10, '#ffffff', 'opacity="0.10"')
    + `</g>`;
}

// ── assemble ──────────────────────────────────────────────────────────────────
export function render(spec) {
  uid = 0;
  const defs = [];
  const s = { head: {}, ...spec };
  s.skinTone = SKIN[s.skin] || s.skin || SKIN.light;
  const acc = (s.acc || []).map((a) => (typeof a === 'string' ? { type: a } : a));
  const accOf = (layer) => acc.filter((a) => (a.layer || defaultLayer(a.type)) === layer).map((a) => ACC[a.type](s, a)).join('');

  const bg = background(s, defs);
  let body = accOf('behind');
  if (s.hoodColor) body += hoodBack(s);
  if (!SPECIAL[s.special] || s.special === 'astronaut' || s.special === 'twin') {
    if (s.special !== 'twin') body += hairBack(s, defs);
  }
  if (!s.noTorso) body += torso(s, defs);
  if (s.special && SPECIAL[s.special]) {
    body += SPECIAL[s.special](s, defs);
  } else {
    body += neck(s) + ears(s);
    body += P(headPath(s.head), s.skinTone) + headShadeLayer(s, defs);
    body += accOf('skin');
    body += cheeks(s) + eyes(s, defs) + brows(s) + nose(s) + mouth(s);
    body += accOf('face');
    body += hairFront(s, defs);
  }
  if (s.hoodColor) body += hoodFront(s);
  body += accOf('head');
  body += accOf('front');
  body = bg + `<g transform="translate(128 ${s.special === 'pixel' ? 128 : 136}) scale(${s.zoom || 1.16}) translate(-128 -128)">${body}</g>`;
  if (s.vignette !== false) {
    const v = id('vig');
    defs.push(`<radialGradient id="${v}" cx="50%" cy="45%" r="62%"><stop offset="0.72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient>`);
    body += `<rect width="${SIZE}" height="${SIZE}" fill="url(#${v})"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"><defs>${defs.join('')}</defs>${body}</svg>`;
}

function defaultLayer(type) {
  if (['wings', 'sparkles', 'notes'].includes(type)) return 'behind';
  if (['freckles', 'scar', 'warpaint', 'runes', 'thirdEye', 'cracks', 'dollCheeks', 'stitches', 'veins', 'clownPaint', 'stubble', 'tear', 'cheekPuff'].includes(type)) return 'skin';
  if (['glasses', 'beard', 'mustache', 'gasMask', 'visor', 'tusks', 'teeth', 'pacifier', 'bandana'].includes(type)) return 'face';
  if (['mic', 'megaphone', 'phone', 'walkie', 'candle', 'cross', 'book', 'finger', 'waves', 'bubbles', 'bone', 'balloon', 'glitch', 'bowtie', 'collarFrill'].includes(type)) return 'front';
  return 'head';
}

function hoodBack(s) {
  const c = s.hoodColor;
  return P(`M${CX - 70},236 C${CX - 78},${CY - 40} ${CX - 52},${CY - 92} ${CX},${CY - 92} C${CX + 52},${CY - 92} ${CX + 78},${CY - 40} ${CX + 70},236Z`, darken(c, 0.25));
}
function hoodFront(s) {
  const c = s.hoodColor;
  return P(`M${CX - 70},236 C${CX - 78},${CY - 40} ${CX - 52},${CY - 92} ${CX},${CY - 92} C${CX + 52},${CY - 92} ${CX + 78},${CY - 40} ${CX + 70},236 L${CX + 52},236 C${CX + 60},${CY + 40} ${CX + 56},${CY - 58} ${CX},${CY - 64} C${CX - 56},${CY - 58} ${CX - 60},${CY + 40} ${CX - 52},236Z`, c)
    + P(`M${CX - 50},${CY - 50} C${CX - 20},${CY - 70} ${CX + 20},${CY - 70} ${CX + 50},${CY - 50} C${CX + 30},${CY - 30} ${CX - 30},${CY - 30} ${CX - 50},${CY - 50}Z`, '#000000', 'opacity="0.35"');
}
