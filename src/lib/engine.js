// Connection to the Python audio engine (ws://localhost:9001).
//
// Two kinds of data come back:
//  - `live`: 30 Hz meter and spectrum values. Kept in a plain mutable object
//    that the WebGL scene and meters read every animation frame, so React
//    never re-renders at audio rate.
//  - `state`: everything else (devices, voices, settings, latency). Exposed to
//    React through useSyncExternalStore.

import { useSyncExternalStore } from 'react';
import bundledVoices from './voices.json';

const WS_URL = 'ws://localhost:9001';
const RECONNECT_MS = 1200;

export const live = {
  inDb: -96,
  outDb: -96,
  gateDb: -96,
  bands: new Array(24).fill(0),
  // smoothed 0..1 values the visuals use
  level: 0,
  inLevel: 0,
};

let state = {
  connected: false,
  running: false,
  monitoring: false,
  bypass: false,
  activeVoice: null,
  devices: [],
  // Shown until the engine sends its own list (tools/export_voices.py keeps this in sync).
  dspVoices: bundledVoices.dsp,
  aiVoices: bundledVoices.ai,
  settings: {
    vol_mic: 1, vol_voice: 1, vol_sound: 1, vol_monitor: 1,
    noise_reduction_enabled: false, noise_gate_enabled: true, noise_gate_level: -44,
  },
  latency: null,
  route: { input: null, output: null },
  lastError: null,
};

const listeners = new Set();
function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}

let socket = null;
let timer = null;

function connect() {
  clearTimeout(timer);
  if (socket && socket.readyState <= 1) return;
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    setState({ connected: true, lastError: null });
    send({ cmd: 'get_devices' });
    send({ cmd: 'get_voices' });
    send({ cmd: 'get_audio_settings' });
    send({ cmd: 'get_latency' });
  };
  socket.onmessage = (e) => {
    try { handle(JSON.parse(e.data)); } catch { /* ignore malformed */ }
  };
  socket.onclose = () => {
    setState({ connected: false, running: false });
    timer = setTimeout(connect, RECONNECT_MS);
  };
  socket.onerror = () => socket.close();
}

const dbTo01 = (db) => Math.min(1, Math.max(0, (db + 60) / 60));

function handle(msg) {
  switch (msg.type) {
    case 'level': {
      live.inDb = msg.input_rms_db;
      live.outDb = msg.output_rms_db;
      live.gateDb = msg.gate_rms_db;
      if (msg.bands) live.bands = msg.bands;
      const patch = {};
      if (msg.running !== state.running) patch.running = msg.running;
      if (msg.monitoring !== state.monitoring) patch.monitoring = msg.monitoring;
      if (typeof msg.bypass === 'boolean' && msg.bypass !== state.bypass) patch.bypass = msg.bypass;
      if (msg.voice !== undefined && msg.voice !== state.activeVoice) patch.activeVoice = msg.voice;
      if (msg.latency) patch.latency = msg.latency;
      if (Object.keys(patch).length) setState(patch);
      break;
    }
    case 'devices': setState({ devices: msg.list || [] }); break;
    case 'voices': setState({ dspVoices: msg.dsp || [], aiVoices: msg.ai || [] }); break;
    case 'voice_set': setState({ activeVoice: msg.id }); break;
    case 'bypass': setState({ bypass: msg.value }); break;
    case 'monitor': setState({ monitoring: msg.active }); break;
    case 'audio_settings': setState({ settings: msg.settings }); break;
    case 'latency': setState({ latency: { ...msg } }); break;
    case 'status':
      setState({
        running: msg.running,
        latency: msg.latency || state.latency,
        route: { input: msg.input ?? null, output: msg.output ?? null },
      });
      break;
    case 'error': setState({ lastError: msg.msg }); break;
    default: break;
  }
}

export function send(cmd) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
}

// Smooth the meter values once per frame; called by whoever owns the RAF loop.
export function tickLive() {
  const target = dbTo01(live.outDb);
  const targetIn = dbTo01(live.inDb);
  live.level += (target - live.level) * (target > live.level ? 0.35 : 0.08);
  live.inLevel += (targetIn - live.inLevel) * (targetIn > live.inLevel ? 0.35 : 0.08);
}

export const actions = {
  setVoice: (id) => { setState({ activeVoice: id }); send({ cmd: 'set_voice', id }); },
  setCustomChain: (chain) => { setState({ activeVoice: 'custom' }); send({ cmd: 'set_custom_chain', chain }); },
  setParam: (effect, param, value) => send({ cmd: 'set_param', effect, param, value }),
  toggleBypass: () => { setState({ bypass: !state.bypass }); send({ cmd: 'toggle_bypass' }); },
  toggleMonitor: (device = null) => send({ cmd: 'toggle_monitor', device }),
  setDevices: (input, output) => send({ cmd: 'set_devices', input, output }),
  rescan: () => send({ cmd: 'get_devices' }),
  playSound: (id) => send({ cmd: 'play_sound', id }),
  stopSound: () => send({ cmd: 'stop_sound' }),
  playFile: (path) => send({ cmd: 'play_file', path }),
  updateSettings: (settings) => {
    setState({ settings: { ...state.settings, ...settings } });
    send({ cmd: 'set_audio_settings', settings });
  },
};

export function useEngine() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

export function findVoice(s, id) {
  if (!id) return null;
  if (id === 'custom') return { id, name: 'Custom chain', category: 'Voice Lab', color: '#b855e7', type: 'custom' };
  return s.aiVoices.find(v => v.id === id) || s.dspVoices.find(v => v.id === id) || null;
}

connect();
