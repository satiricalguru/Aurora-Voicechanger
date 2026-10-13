import { useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Plus, X, GripVertical, Play, Save, Trash2 } from 'lucide-react';
import { actions, useEngine } from '../lib/engine';
import { RevealLines, FadeUp } from './Reveal';

const FX = [
  { id: 'pitch', name: 'Pitch & formant', params: [
    { key: 'semitones', label: 'Semitones', min: -12, max: 12, step: 0.5, def: 0 },
    { key: 'formant', label: 'Formant', min: 0.6, max: 1.6, step: 0.01, def: 1 } ] },
  { id: 'robot', name: 'Vocoder', params: [
    { key: 'carrier_freq', label: 'Carrier Hz', min: 50, max: 400, step: 5, def: 120 },
    { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.8 } ] },
  { id: 'reverb', name: 'Reverb', params: [
    { key: 'room', label: 'Room', min: 0, max: 1, step: 0.01, def: 0.4 },
    { key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, def: 0.25 },
    { key: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, def: 0.6 } ] },
  { id: 'chorus', name: 'Chorus', params: [
    { key: 'rate', label: 'Rate Hz', min: 0.1, max: 8, step: 0.1, def: 1.5 },
    { key: 'depth', label: 'Depth ms', min: 1, max: 30, step: 1, def: 10 },
    { key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, def: 0.5 } ] },
  { id: 'distortion', name: 'Drive & crush', params: [
    { key: 'drive', label: 'Drive', min: 1, max: 20, step: 0.5, def: 3 },
    { key: 'bits', label: 'Bits', min: 4, max: 16, step: 1, def: 16 } ] },
  { id: 'eq', name: 'EQ', params: [
    { key: 'low', label: 'Low dB', min: -15, max: 15, step: 0.5, def: 0 },
    { key: 'mid', label: 'Mid dB', min: -15, max: 15, step: 0.5, def: 0 },
    { key: 'high', label: 'High dB', min: -15, max: 15, step: 0.5, def: 0 } ] },
  { id: 'delay', name: 'Echo', params: [
    { key: 'delay_ms', label: 'Time ms', min: 20, max: 800, step: 10, def: 250 },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, def: 0.3 },
    { key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, def: 0.4 } ] },
  { id: 'wah', name: 'Wah', params: [
    { key: 'rate', label: 'Rate Hz', min: 0.1, max: 8, step: 0.1, def: 2 },
    { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.7 } ] },
  { id: 'harmony', name: 'Harmony', params: [
    { key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, def: 0.4 } ] },
  { id: 'whisper', name: 'Whisper', params: [
    { key: 'breathiness', label: 'Breath', min: 0, max: 1, step: 0.01, def: 0.7 } ] },
  { id: 'vibrato', name: 'Vibrato', params: [
    { key: 'rate', label: 'Rate Hz', min: 0.5, max: 10, step: 0.1, def: 5 },
    { key: 'depth', label: 'Depth', min: 0, max: 2, step: 0.01, def: 0.3 } ] },
  { id: 'autotune', name: 'Autotune', params: [
    { key: 'speed', label: 'Snap', min: 0, max: 1, step: 0.01, def: 0.05 } ] },
  { id: 'noise_inject', name: 'Radio noise', params: [
    { key: 'level', label: 'Level', min: 0, max: 0.2, step: 0.005, def: 0.03 } ] },
];
const SAVED_KEY = 'aurora.lab.saved.v1';
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; } };
const storeSaved = (list) => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* private mode */ } };
const byId = Object.fromEntries(FX.map(f => [f.id, f]));

const toStages = (chain) => chain.map(n => ({ effect: n.fx, ...n.params }));

export default function VoiceLab() {
  const engine = useEngine();
  const [chain, setChain] = useState([]);
  const [saved, setSaved] = useState(loadSaved);
  const [name, setName] = useState('');
  const live = engine.activeVoice === 'custom';

  const save = () => {
    const n = name.trim() || `My voice ${saved.length + 1}`;
    const next = [...saved.filter(v => v.name !== n), { name: n, chain: chain.map(({ fx, params }) => ({ fx, params })) }];
    setSaved(next); storeSaved(next); setName('');
  };
  const load = (v) => commit(v.chain.map((n, i) => ({ ...n, key: `${n.fx}-${Date.now()}-${i}` })));
  const forget = (n) => { const next = saved.filter(v => v.name !== n); setSaved(next); storeSaved(next); };

  function commit(next) {
    setChain(next);
    if (live || next.length) actions.setCustomChain(toStages(next));
  }
  const add = (fx) => commit([...chain, {
    key: `${fx}-${Date.now()}`, fx,
    params: Object.fromEntries(byId[fx].params.map(p => [p.key, p.def])),
  }]);
  const remove = (key) => commit(chain.filter(n => n.key !== key));
  const setParam = (node, k, v) => {
    setChain(c => c.map(n => (n.key === node.key ? { ...n, params: { ...n.params, [k]: v } } : n)));
    if (live) actions.setParam(node.fx, k, v);
  };

  return (
    <section id="lab" className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow">03 · Voice Lab</div>
          <RevealLines className="h-section" lines={['Build your', <span className="dim" key="d">own voice.</span>]} />
          <FadeUp><p className="lede">Stack effects in any order. Changes go live as you drag.</p></FadeUp>
        </div>
        <FadeUp delay={0.1}>
          <button className="btn btn-primary" onClick={() => actions.setCustomChain(toStages(chain))} disabled={!chain.length}>
            <Play size={14} /> {live ? 'Live now' : 'Use this voice'}
          </button>
        </FadeUp>
      </div>

      <FadeUp className="lab">
        <div className="panel">
          <h3>Effects</h3>
          <p className="sub">Click to add to the chain</p>
          <div className="fx-palette">
            {FX.map(f => (
              <button key={f.id} onClick={() => add(f.id)}>{f.name}<Plus size={14} /></button>
            ))}
          </div>
          {saved.length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>Saved voices</h3>
              <p className="sub">Load one to keep editing it</p>
              <div className="saved-list">
                {saved.map(v => (
                  <div key={v.name} className="saved-item">
                    <button onClick={() => load(v)}>{v.name}<small>{v.chain.length} fx</small></button>
                    <button className="icon-btn" onClick={() => forget(v.name)} aria-label={`Delete ${v.name}`}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h3>Chain</h3>
          <p className="sub">{chain.length ? `${chain.length} effect${chain.length > 1 ? 's' : ''}, top to bottom. Drag to reorder.` : 'Your voice runs through these in order.'}</p>
          {!chain.length && <div className="empty">Add an effect to start. Try Pitch, then Reverb.</div>}
          {chain.length > 0 && (
            <div className="lab-save">
              <input className="input" value={name} maxLength={32} placeholder="Name this voice" onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} aria-label="Voice name" />
              <button className="btn btn-ghost" onClick={save}><Save size={14} /> Save</button>
            </div>
          )}
          <Reorder.Group axis="y" values={chain} onReorder={commit} className="chain" as="div">
            <AnimatePresence initial={false}>
              {chain.map((n, i) => (
                <Reorder.Item key={n.key} value={n} as="div" className="node"
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}>
                  <div className="node-head">
                    <GripVertical size={14} style={{ color: 'var(--text-4)', cursor: 'grab' }} />
                    <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className="nm">{byId[n.fx].name}</span>
                    <button onClick={() => remove(n.key)} aria-label="Remove"><X size={14} /></button>
                  </div>
                  <div className="node-params">
                    {byId[n.fx].params.map(p => (
                      <Slider key={p.key} p={p} value={n.params[p.key]} onChange={(v) => setParam(n, p.key, v)} />
                    ))}
                  </div>
                </Reorder.Item>
              ))}
            </AnimatePresence>
          </Reorder.Group>
        </div>
      </FadeUp>
    </section>
  );
}

export function Slider({ p, value, onChange, format }) {
  const pct = ((value - p.min) / (p.max - p.min)) * 100;
  const shown = format ? format(value) : (p.step < 1 ? value.toFixed(2) : Math.round(value));
  return (
    <div className="field">
      <label>{p.label}<output>{shown}</output></label>
      <input
        type="range" className="slider" min={p.min} max={p.max} step={p.step} value={value}
        style={{ '--val': `${pct}%` }}
        onPointerDown={e => e.stopPropagation()}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}
