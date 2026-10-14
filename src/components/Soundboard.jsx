import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Square, Upload, MoreHorizontal, Repeat, Trash2, Keyboard, X, Loader2 } from 'lucide-react';
import { actions } from '../lib/engine';
import { RevealLines, FadeUp, staggerParent, staggerChild } from './Reveal';
import { Slider } from './VoiceLab';

const ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.aif,.aiff,.flac,.caf,.ogg';
const isDesktop = !!window.electronAPI?.setSoundHotkeys;

// Electron accelerator from a keydown event ("Shift+1", "CommandOrControl+K", "F6").
function accelerator(e) {
  const k = e.key;
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(k)) return null;
  let key = k.length === 1 ? k.toUpperCase() : k;
  if (e.code?.startsWith('Digit')) key = e.code.slice(5);
  if (e.code?.startsWith('Numpad')) key = 'num' + e.code.slice(6);
  if (key === ' ') key = 'Space';
  const mods = [];
  if (e.metaKey || e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const fn = /^F\d{1,2}$/.test(key);
  if (!mods.length && !fn) return null;  // plain letters would fire while typing elsewhere
  if (['F1', 'F2', 'F3', 'F4', 'F5', 'F6'].includes(key) && !mods.length) return null;  // reserved
  return [...mods, key].join('+');
}
const pretty = (acc) => (acc || '').replace('CommandOrControl', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace(/\+/g, ' ');

export default function Soundboard({ engine }) {
  const { sounds, soundPlaying, soundError, uploading } = engine;
  const [current, setCurrent] = useState(null);
  const [menu, setMenu] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const depth = useRef(0);

  useEffect(() => { if (!soundPlaying) setCurrent(null); }, [soundPlaying]);

  // In a plain browser there are no global shortcuts: listen locally instead.
  useEffect(() => {
    if (isDesktop) return undefined;
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const acc = accelerator(e);
      const hit = acc && sounds.find(s => s.hotkey === acc);
      if (hit) { e.preventDefault(); play(hit.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function play(id) {
    if (current === id && soundPlaying) { actions.stopSound(); setCurrent(null); return; }
    setCurrent(id);
    actions.playSound(id);
  }

  async function addFiles(list) {
    for (const f of Array.from(list || [])) {
      if (f.type && !f.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|aiff?|flac|caf|ogg)$/i.test(f.name)) continue;
      await actions.addSound(f);
    }
  }

  const dragProps = {
    onDragEnter: (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth.current += 1; setDrag(true); } },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDrag(false); },
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => { e.preventDefault(); depth.current = 0; setDrag(false); addFiles(e.dataTransfer.files); },
  };

  const custom = sounds.filter(s => !s.builtin);
  const builtin = sounds.filter(s => s.builtin);

  return (
    <section id="soundboard" className={`section ${drag ? 'dropping' : ''}`} {...dragProps}>
      <div className="section-head">
        <div>
          <div className="eyebrow">02 · Soundboard</div>
          <RevealLines className="h-section" lines={['Drop a sound', <span className="dim" key="d">into the call.</span>]} />
          <FadeUp>
            <p className="lede">
              Pads play to the call and to your headphones. Add your own clips (MP3, WAV, M4A, FLAC… up to 2 minutes) and give them a {isDesktop ? 'global ' : ''}hotkey.
            </p>
          </FadeUp>
        </div>
        <FadeUp delay={0.1}>
          <div className="sb-actions">
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}><Upload size={15} /> Add sounds</button>
            <button className="btn btn-ghost" onClick={() => { actions.stopSound(); setCurrent(null); }} disabled={!soundPlaying}><Square size={14} /> Stop</button>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>
        </FadeUp>
      </div>

      {(soundError || uploading > 0) && (
        <div className={`banner ${soundError ? 'banner-bad' : ''}`} style={{ marginBottom: 18 }}>
          {soundError ? <X size={16} /> : <Loader2 size={16} className="spin" />}
          <span>{soundError || `Adding ${uploading} sound${uploading > 1 ? 's' : ''}…`}</span>
          {soundError && <a onClick={actions.clearSoundError}>Dismiss</a>}
        </div>
      )}

      <h4 className="sb-group">Your sounds</h4>
      {/* Keyed by the sound ids so newly added pads get the entrance animation too. */}
      <motion.div className="pads" variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-5% 0px' }} key={custom.map(c => c.id).join(',')}>
        {custom.map(s => (
          <Pad key={s.id} s={s} playing={soundPlaying && current === s.id} onPlay={() => play(s.id)} menuOpen={menu === s.id} onMenu={() => setMenu(menu === s.id ? null : s.id)} />
        ))}
        <motion.button variants={staggerChild} className="pad add" onClick={() => fileRef.current?.click()}>
          <Plus size={18} /> {custom.length ? 'Add more' : 'Add your first sound'}
          <small>or drop files here</small>
        </motion.button>
      </motion.div>

      <h4 className="sb-group">Built in</h4>
      <motion.div className="pads" variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-5% 0px' }}>
        {builtin.map(s => (
          <Pad key={s.id} s={s} playing={soundPlaying && current === s.id} onPlay={() => play(s.id)} menuOpen={menu === s.id} onMenu={() => setMenu(menu === s.id ? null : s.id)} />
        ))}
      </motion.div>

      <AnimatePresence>
        {drag && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Upload size={28} /> Drop audio files to add them
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Pad({ s, playing, onPlay, menuOpen, onMenu }) {
  return (
    <motion.div variants={staggerChild} className={`pad ${playing ? 'on' : ''} ${menuOpen ? 'menu-open' : ''}`} style={{ '--c': s.color }}>
      <button className="pad-hit" onClick={onPlay} aria-label={`${playing ? 'Stop' : 'Play'} ${s.name}`}>
        <span className="ripple" />
        <span className="num">
          {s.hotkey ? pretty(s.hotkey) : `${s.duration?.toFixed?.(1) ?? '—'} s`}
          {s.loop && <Repeat size={11} style={{ marginLeft: 6, verticalAlign: '-1px' }} />}
        </span>
        <span className="bars">
          {[0.5, 0.9, 0.6, 1, 0.4].map((h, j) => (
            <i key={j} style={{ height: playing ? `${h * 100}%` : '18%', transitionDelay: `${j * 40}ms` }} />
          ))}
        </span>
        <span className="t">{s.name}</span>
      </button>
      <button className="pad-more" onClick={onMenu} aria-label={`Options for ${s.name}`} aria-expanded={menuOpen}><MoreHorizontal size={16} /></button>
      <AnimatePresence>{menuOpen && <PadMenu s={s} onClose={onMenu} />}</AnimatePresence>
    </motion.div>
  );
}

function PadMenu({ s, onClose }) {
  const [name, setName] = useState(s.name);
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    if (!binding) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { setBinding(false); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { actions.updateSound(s.id, { hotkey: null }); setBinding(false); return; }
      const acc = accelerator(e);
      if (acc) { actions.updateSound(s.id, { hotkey: acc }); setBinding(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [binding, s.id]);

  const commitName = () => { if (!s.builtin && name.trim() && name !== s.name) actions.updateSound(s.id, { name: name.trim() }); };

  return (
    <motion.div className="pad-menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} onClick={e => e.stopPropagation()}>
      {!s.builtin && (
        <input className="input" value={name} maxLength={40} onChange={e => setName(e.target.value)} onBlur={commitName} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Sound name" />
      )}
      <Slider p={{ label: 'Volume', min: 0, max: 2, step: 0.01 }} value={s.volume ?? 1} format={v => `${Math.round(v * 100)}%`} onChange={v => actions.updateSound(s.id, { volume: v })} />
      <div className="pad-menu-row">
        <button className={`chip ${s.loop ? 'on' : ''}`} onClick={() => actions.updateSound(s.id, { loop: !s.loop })} aria-pressed={!!s.loop}><Repeat size={12} /> Loop</button>
        <button className={`chip ${binding ? 'on' : ''}`} onClick={() => setBinding(b => !b)}>
          <Keyboard size={12} /> {binding ? 'Press keys… (⌫ clears)' : s.hotkey ? pretty(s.hotkey) : 'Set hotkey'}
        </button>
      </div>
      <div className="pad-menu-row">
        {!s.builtin && <button className="chip danger" onClick={() => { actions.deleteSound(s.id); onClose(); }}><Trash2 size={12} /> Delete</button>}
        <button className="chip" onClick={onClose} style={{ marginLeft: 'auto' }}>Done</button>
      </div>
    </motion.div>
  );
}
