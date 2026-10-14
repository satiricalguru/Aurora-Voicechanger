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
  level: 0,
  inLevel: 0,
  rec: { voice: 0, mac: 0 },   // capture peaks (0..1), for the recorder meters
};

let state = {
  connected: false,
  running: false,
  monitoring: false,
  bypass: false,
  muted: false,
  activeVoice: null,
  sounds: [],
  soundPlaying: false,
  soundError: null,
  uploading: 0,
  recordings: [],
  rec: null,        // recorder status: recording, seconds, replay settings, Mac capture...
  recError: null,
  toast: null,      // { id, text } — short confirmation (also for hotkeys)
  devices: [],
  dspVoices: bundledVoices.dsp,
  aiVoices: (bundledVoices.ai || []).map(normalizeCharacter),
  settings: {
    vol_mic: 1, vol_voice: 1, vol_sound: 1, vol_monitor: 1,
    noise_reduction_enabled: false, noise_reduction_mode: 'balanced', noise_reduction_strength: 0.85,
    noise_gate_enabled: true, noise_gate_level: -44,
  },
  latency: null,
  route: { input: null, output: null },
  lastError: null,
  backend: 'python',
};

const listeners = new Set();
function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}

function normalizeCharacter(v) {
  return {
    ...v,
    category: 'Characters',
    type: v.type === 'ai' || v.type === 'neural' ? v.type : 'character',
  };
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
    send({ cmd: 'get_backend' });
    send({ cmd: 'list_sounds' });
    send({ cmd: 'list_recordings' });
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
      if (typeof msg.muted === 'boolean' && msg.muted !== state.muted) patch.muted = msg.muted;
      if (typeof msg.sound_playing === 'boolean' && msg.sound_playing !== state.soundPlaying) patch.soundPlaying = msg.sound_playing;
      if (msg.voice !== undefined && msg.voice !== state.activeVoice) patch.activeVoice = msg.voice;
      if (msg.latency) patch.latency = msg.latency;
      if (msg.error) patch.lastError = msg.error;
      if (msg.capture) {
        const c = msg.capture;
        live.rec.voice = Math.max(c.level?.voice || 0, live.rec.voice * 0.85);
        live.rec.mac = Math.max(c.level?.mac || 0, live.rec.mac * 0.85);
        // Re-render only when something visible changes (whole seconds, flags).
        const key = JSON.stringify([c.recording, c.source, Math.floor(c.seconds), Math.floor(c.replay?.buffered || 0),
          c.replay, c.mac_capture, c.mac_pending, c.mac_permission, c.mac_silent, c.error, c.supported]);
        if (key !== recKey) { recKey = key; patch.rec = c; }
      }
      if (Object.keys(patch).length) setState(patch);
      break;
    }
    case 'recordings': {
      const patch = { recordings: msg.list || [], recError: null };
      if (msg.status) { patch.rec = msg.status; recKey = ''; }
      const added = msg.added && (msg.list || []).find(r => r.id === msg.added);
      if (added) patch.toast = { id: Date.now(), text: msg.replay ? `Saved the last ${Math.round(added.duration)} s` : `Recording saved · ${fmtTime(added.duration)}` };
      setState(patch);
      break;
    }
    case 'record_error': setState({ recError: msg.msg }); break;
    case 'recording_audio': {
      const pending = audioWaiters.get(msg.id);
      if (pending) { audioWaiters.delete(msg.id); pending(msg.data); }
      break;
    }
    case 'virtual_mic':
      setState({ lastError: msg.ok ? null : (msg.msg || 'Virtual mic install failed') });
      if (msg.ok) send({ cmd: 'get_devices' });
      break;
    case 'devices': setState({ devices: msg.list || [] }); break;
    case 'voices':
      setState({
        dspVoices: msg.dsp || [],
        aiVoices: (msg.ai || []).map(normalizeCharacter),
      });
      break;
    case 'voice_set': setState({ activeVoice: msg.id }); break;
    case 'bypass': setState({ bypass: msg.value }); break;
    case 'mute': setState({ muted: msg.value }); break;
    case 'sounds':
      setState({
        sounds: msg.list || [],
        uploading: msg.added && !msg.from_recording ? Math.max(0, state.uploading - 1) : state.uploading,
        soundError: null,
        ...(msg.from_recording ? { toast: { id: Date.now(), text: 'Added to the soundboard' } } : {}),
      });
      syncSoundHotkeys(msg.list || []);
      break;
    case 'sound_error': setState({ soundError: msg.msg, uploading: Math.max(0, state.uploading - 1) }); break;
    case 'monitor': setState({ monitoring: msg.active }); break;
    case 'audio_settings': setState({ settings: msg.settings }); break;
    case 'latency': setState({ latency: { ...msg } }); break;
    case 'backend': setState({ backend: msg.backend || 'python' }); break;
    case 'status':
      setState({
        running: msg.running,
        latency: msg.latency || state.latency,
        route: { input: msg.input ?? null, output: msg.output ?? null },
        lastError: null,
      });
      break;
    case 'error': setState({ lastError: msg.msg }); break;
    default: break;
  }
}

let recKey = '';
const audioWaiters = new Map();
const audioCache = new Map();  // recording id -> blob URL

export const fmtTime = (s) => {
  const t = Math.max(0, Math.round(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function send(cmd) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
}

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
  toggleMute: () => { setState({ muted: !state.muted }); send({ cmd: 'toggle_mute' }); },
  playSound: (id) => { setState({ soundPlaying: true }); send({ cmd: 'play_sound', id }); },
  stopSound: () => { setState({ soundPlaying: false }); send({ cmd: 'stop_sound' }); },
  // Upload an audio file into the soundboard library (decoded and stored by the engine).
  addSound: (file) => new Promise((resolve) => {
    if (file.size > 25 * 1024 * 1024) { setState({ soundError: `${file.name} is larger than 25 MB` }); resolve(false); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result).split(',')[1] || '';
      setState({ uploading: state.uploading + 1, soundError: null });
      send({ cmd: 'add_sound', name: file.name.replace(/\.[^.]+$/, ''), filename: file.name, data });
      resolve(true);
    };
    reader.onerror = () => { setState({ soundError: `Could not read ${file.name}` }); resolve(false); };
    reader.readAsDataURL(file);
  }),
  updateSound: (id, changes) => {
    setState({ sounds: state.sounds.map(s => (s.id === id ? { ...s, ...changes } : s)) });
    send({ cmd: 'update_sound', id, changes });
  },
  deleteSound: (id) => {
    setState({ sounds: state.sounds.filter(s => s.id !== id) });
    send({ cmd: 'delete_sound', id });
  },
  clearSoundError: () => setState({ soundError: null }),
  // Recorder and instant replay ('voice' = what the call hears, 'mac' = other apps).
  recordStart: (source) => send({ cmd: 'record_start', source }),
  recordStop: () => send({ cmd: 'record_stop' }),
  saveReplay: () => send({ cmd: 'replay_save' }),
  setReplay: (settings) => {
    if (state.rec) setState({ rec: { ...state.rec, replay: { ...state.rec.replay, ...settings } } });
    send({ cmd: 'set_replay', settings });
  },
  renameRecording: (id, name) => {
    setState({ recordings: state.recordings.map(r => (r.id === id ? { ...r, name } : r)) });
    send({ cmd: 'rename_recording', id, name });
  },
  deleteRecording: (id) => {
    setState({ recordings: state.recordings.filter(r => r.id !== id) });
    const url = audioCache.get(id);
    if (url) { URL.revokeObjectURL(url); audioCache.delete(id); }
    send({ cmd: 'delete_recording', id });
  },
  recordingToSound: (id, start, end, name) => send({ cmd: 'recording_to_sound', id, start, end, name }),
  clearRecError: () => setState({ recError: null }),
  // Blob URL of a recording, for previewing it in the window.
  recordingUrl: (id) => {
    if (audioCache.has(id)) return Promise.resolve(audioCache.get(id));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { audioWaiters.delete(id); reject(new Error('timeout')); }, 15000);
      audioWaiters.set(id, (b64) => {
        clearTimeout(t);
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        audioCache.set(id, url);
        resolve(url);
      });
      send({ cmd: 'recording_audio', id });
    });
  },
  measureLatency: () => send({ cmd: 'measure_latency' }),
  installVirtualMic: () => send({ cmd: 'install_virtual_mic' }),
  updateSettings: (settings) => {
    setState({ settings: { ...state.settings, ...settings } });
    send({ cmd: 'set_audio_settings', settings });
  },
};

// Soundboard keybinds: global (work in the background) inside the desktop app.
function syncSoundHotkeys(list) {
  const binds = list.filter(s => s.hotkey).map(s => ({ accelerator: s.hotkey, id: s.id }));
  window.electronAPI?.setSoundHotkeys?.(binds);
}

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
