import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Power, Headphones } from 'lucide-react';
import { actions, live } from '../lib/engine';
import Avatar from './Avatar';

export default function Dock({ engine, voice }) {
  const inRef = useRef(null);
  const outRef = useRef(null);

  // Meters update straight from the 30 Hz feed, outside React.
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

  const lat = engine.latency;
  return (
    <motion.div className="dock" initial={{ y: 120, x: '-50%', opacity: 0 }} animate={{ y: 0, x: '-50%', opacity: 1 }} transition={{ delay: 0.5, duration: 1, ease: [0.16, 1, 0.3, 1] }}>
      <div className="who">
        <Avatar voice={voice} size={34} />
        <div style={{ minWidth: 0 }}>
          <div className="t">{voice?.name || 'Original voice'}</div>
          <div className="s">{engine.bypass ? 'VOICE OFF' : engine.running ? 'LIVE' : engine.connected ? 'NO OUTPUT' : 'OFFLINE'}</div>
        </div>
      </div>
      <div className="meter">IN<div className="track"><div className="fill" ref={inRef} /></div></div>
      <div className="meter">OUT<div className="track"><div className="fill" ref={outRef} /></div></div>
      <div className="latency"><b>{lat ? lat.total_ms.toFixed(1) : '—'}</b> ms</div>
      <button className={`btn btn-ghost ${engine.monitoring ? 'on' : ''}`} onClick={() => actions.toggleMonitor()} aria-label="Hear myself">
        <Headphones size={15} />
      </button>
      <button className="btn btn-primary" onClick={actions.toggleBypass}>
        <Power size={15} /> {engine.bypass ? 'Off' : 'On'}
      </button>
    </motion.div>
  );
}
