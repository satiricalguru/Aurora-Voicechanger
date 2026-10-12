import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { actions } from '../lib/engine';
import { RevealLines, FadeUp, staggerParent, staggerChild } from './Reveal';

const PADS = [
  { id: 0, name: 'Air Horn', color: '#ffb764' },
  { id: 1, name: 'Applause', color: '#ffdd00' },
  { id: 2, name: 'Drum Roll', color: '#e6714f' },
  { id: 3, name: 'Evil Laugh', color: '#b855e7' },
  { id: 4, name: 'Crickets', color: '#16c253' },
  { id: 5, name: 'Oof', color: '#0088ff' },
  { id: 6, name: 'Sad Trombone', color: '#e6714f' },
  { id: 7, name: 'Boom', color: '#dd55e7' },
  { id: 8, name: 'Hype Horn', color: '#60a5fa' },
  { id: 9, name: 'Night', color: '#4b52aa' },
  { id: 10, name: 'Ba Dum Tss', color: '#ffb764' },
  { id: 11, name: 'Chime', color: '#27c93f' },
];

export default function Soundboard() {
  const [playing, setPlaying] = useState(null);
  const [custom, setCustom] = useState([]);
  const fileRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const n = '1234567890'.indexOf(e.key);
      if (n >= 0 && PADS[n]) play(PADS[n].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function play(id, path) {
    clearTimeout(timer.current);
    if (playing === id) { actions.stopSound(); setPlaying(null); return; }
    setPlaying(id);
    if (path) actions.playFile(path); else actions.playSound(id);
    timer.current = setTimeout(() => setPlaying(null), path ? 3000 : 2000);
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const path = window.electronAPI?.getPathForFile?.(file);
    if (!path) return;
    const pad = { id: `f${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ''), color: '#a887dc', path };
    setCustom(c => [...c, pad]);
    e.target.value = '';
  }

  return (
    <section id="soundboard" className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow">03 · Soundboard</div>
          <RevealLines className="h-section" lines={['Drop a sound', <span className="dim" key="d">into the call.</span>]} />
          <FadeUp><p className="lede">Sounds play to your headphones. Keys 1 to 0 trigger the first ten pads.</p></FadeUp>
        </div>
      </div>
      <motion.div className="pads" variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-5% 0px' }}>
        {[...PADS, ...custom].map((p, i) => (
          <motion.button
            key={p.id}
            variants={staggerChild}
            className={`pad ${playing === p.id ? 'on' : ''}`}
            style={{ '--c': p.color }}
            onClick={() => play(p.id, p.path)}
          >
            <span className="ripple" />
            <span className="num">{p.path ? 'FILE' : i < 10 ? `KEY ${(i + 1) % 10}` : 'PAD'}</span>
            <span className="bars">
              {[0.5, 0.9, 0.6, 1, 0.4].map((h, j) => (
                <i key={j} style={{ height: playing === p.id ? `${h * 100}%` : '18%', transitionDelay: `${j * 40}ms` }} />
              ))}
            </span>
            <span className="t">{p.name}</span>
          </motion.button>
        ))}
        <motion.button variants={staggerChild} className="pad add" onClick={() => fileRef.current?.click()}>
          <Plus size={18} /> Add a sound
          <input ref={fileRef} type="file" accept="audio/*" hidden onChange={onFile} />
        </motion.button>
      </motion.div>
    </section>
  );
}
