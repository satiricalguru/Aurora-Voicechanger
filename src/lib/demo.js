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
  const virtual = /aurora microphone|blackhole|voicemod|dubbing|virtual|loopback|soundflower|vb-audio|cable/i;
  const real = devices.filter(d => d.inputs > 0 && !virtual.test(d.name || ''));
  const def = real.find(d => d.is_default_input);
  if (def) return def;
  const builtIn = real.find(d => /macbook|built-in|microphone/i.test(d.name || ''));
  return builtIn || real[0] || null;
}

/** Where the changed voice goes: Aurora Microphone, else BlackHole. */
export function findVirtualMic(devices) {
  const outs = devices.filter(d => d.outputs > 0);
  return outs.find(d => d.is_aurora) || outs.find(d => d.is_blackhole) || null;
}
