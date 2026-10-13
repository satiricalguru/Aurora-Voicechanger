import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Power, Headphones } from 'lucide-react';
import { actions, live } from '../lib/engine';
import { findBlackHole } from '../lib/demo';
import Avatar from './Avatar';

function statusLabel(engine) {
  if (!engine.connected) return { text: 'STARTING…', hint: 'Engine offline' };
  if (!engine.running) {
    const bh = findBlackHole(engine.devices);
    return bh
      ? { text: 'READY', hint: 'Tap On to go live' }
      : { text: 'CHOOSE OUTPUT', hint: 'Finish Setup — need BlackHole' };
  }
  if (engine.bypass) return { text: 'VOICE OFF', hint: 'Bypassed' };
  return { text: 'LIVE', hint: 'Others hear this character' };
}

function latencyLabel(lat) {
  if (!lat) return { value: '—', unit: 'ms', caption: 'Device' };
  // Prefer measured loopback when available.
  if (typeof lat.measured_ms === 'number' && lat.measured_ms > 0) {
    return { value: lat.measured_ms.toFixed(1), unit: 'ms', caption: 'Measured' };
  }
  return { value: lat.total_ms.toFixed(1), unit: 'ms', caption: 'Device' };
}

export default function Dock({ engine, voice, onOpenSetup }) {
  const inRef = useRef(null);
  const outRef = useRef(null);

  useEffect(() => {
    let raf;
    const loop = () => {
      if (inRef.current) inRef.current.style.transform = `scaleX(${live.inLevel.toFixed(3)})`;
      if (outRef.current) outRef.current.style.transform = `scaleX(${live.level.toFixed(3)})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const st = statusLabel(engine);
  const lat = latencyLabel(engine.latency);
  const hot = engine.latency && (engine.latency.dsp_ms > 3 || engine.latency.xruns > 0);
  const clickStatus = () => {
    if (!engine.connected || !engine.running || !findBlackHole(engine.devices)) onOpenSetup?.();
  };

  return (
    <motion.div className="dock" initial={{ y: 120, x: '-50%', opacity: 0 }} animate={{ y: 0, x: '-50%', opacity: 1 }} transition={{ delay: 0.5, duration: 1, ease: [0.16, 1, 0.3, 1] }}>
      <div className="who" onClick={clickStatus} role="presentation" title={st.hint}>
        <Avatar voice={voice} size={34} />
        <div style={{ minWidth: 0 }}>
          <div className="t">{voice?.name || 'Original voice'}</div>
          <div className={`s ${st.text === 'LIVE' ? 'live' : ''}`}>{st.text}</div>
        </div>
      </div>
      <div className="meter">IN<div className="track"><div className="fill" ref={inRef} /></div></div>
      <div className="meter">OUT<div className="track"><div className="fill" ref={outRef} /></div></div>
      <div className={`latency ${hot ? 'hot' : ''}`} title={hot ? `DSP ${engine.latency.dsp_ms.toFixed(2)} ms · ${engine.latency.xruns} dropouts` : `${lat.caption} latency`}>
        <b>{lat.value}</b> {lat.unit}
        <small>{lat.caption}</small>
      </div>
      <button className={`btn btn-ghost ${engine.monitoring ? 'on' : ''}`} onClick={() => actions.toggleMonitor()} aria-label="Hear myself" title="Hear myself (F2)">
        <Headphones size={15} />
      </button>
      <button className="btn btn-primary" onClick={actions.toggleBypass} title="Voice on/off (F1)">
        <Power size={15} /> {engine.bypass ? 'Off' : 'On'}
      </button>
    </motion.div>
  );
}
