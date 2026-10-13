/** Demo-scoped product mode. Set VITE_FULL_UI=1 to show Effects / Soundboard / Lab. */
export const DEMO_MODE = import.meta.env.VITE_FULL_UI !== '1';

/** First character applied on connect when none is active. */
export const SHOWCASE_VOICE = 'kawaii';

export const BH_DOWNLOAD = 'https://existential.audio/blackhole/';

const SETUP_KEY = 'aurora.setup.complete.v1';

export function isSetupComplete() {
  try { return localStorage.getItem(SETUP_KEY) === '1'; } catch { return false; }
}

export function markSetupComplete() {
  try { localStorage.setItem(SETUP_KEY, '1'); } catch { /* ignore */ }
}

export function resetSetupComplete() {
  try { localStorage.removeItem(SETUP_KEY); } catch { /* ignore */ }
}

/** Prefer built-in / MacBook mics; skip virtual cables. */
export function pickRealMic(devices) {
  const virtual = /blackhole|voicemod|dubbing|virtual|loopback|soundflower|vb-audio|cable/i;
  const real = devices.filter(d => d.inputs > 0 && !virtual.test(d.name || ''));
  const def = real.find(d => d.is_default_input);
  if (def) return def;
  const builtIn = real.find(d => /macbook|built-in|microphone/i.test(d.name || ''));
  return builtIn || real[0] || null;
}

export function findBlackHole(devices) {
  return devices.find(d => d.is_blackhole && d.outputs > 0) || null;
}
