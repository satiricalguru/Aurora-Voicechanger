// Shared, frame-rate values that both the DOM and the WebGL scene read.
// Written by the Lenis scroll loop and pointer listener, never by React.
export const motion = {
  scroll: 0,      // px
  hero: 0,        // 0..1 progress through the first viewport
  page: 0,        // 0..1 progress through the whole page
  velocity: 0,    // Lenis velocity, px per frame
  pointer: { x: 0, y: 0 }, // -1..1
  tint: [0.72, 0.33, 0.9], // active voice colour, linear-ish rgb 0..1
};

export function hexToRgb01(hex) {
  const h = (hex || '#b855e7').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
