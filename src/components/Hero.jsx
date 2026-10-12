import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { Power, Headphones, ArrowDown, Info } from 'lucide-react';
import { actions } from '../lib/engine';

const ease = [0.16, 1, 0.3, 1];

export default function Hero({ engine, voice, onNav }) {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 900], [0, -180]);
  const opacity = useTransform(scrollY, [0, 520], [1, 0]);
  const blur = useTransform(scrollY, [0, 520], ['blur(0px)', 'blur(8px)']);

  const lat = engine.latency;
  const name = voice?.name || 'Your voice';
  const sub = voice
    ? (voice.description || `${voice.category} effect`)
    : 'Pick a character or effect below. Everything runs locally on your Mac.';
  const hasBlackHole = engine.devices.some(d => d.is_blackhole);
  const on = engine.running && !engine.bypass;

  return (
    <section id="home" className="section hero">
      <motion.div className="hero-copy" style={{ y, opacity, filter: blur }}>
        <motion.div className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.8 }}>
          <b>●</b> {on ? 'Now speaking as' : engine.running ? 'Voice paused' : 'Ready when you are'}
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.h1
            key={name}
            className="h-display"
            style={{ marginTop: 18, fontSize: name.length > 14 ? 'clamp(40px, 5.6vw, 76px)' : undefined }}
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.7, ease }}
          >
            {name}
          </motion.h1>
        </AnimatePresence>
        <p className="lede">{sub}</p>

        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={actions.toggleBypass} disabled={!engine.connected}>
            <Power size={16} /> {engine.bypass ? 'Turn voice on' : 'Turn voice off'} <kbd>F1</kbd>
          </button>
          <button className={`btn btn-ghost btn-lg ${engine.monitoring ? 'on' : ''}`} onClick={() => actions.toggleMonitor()} disabled={!engine.connected}>
            <Headphones size={16} /> {engine.monitoring ? 'Hearing myself' : 'Hear myself'}
          </button>
        </div>

        <div className="hero-meta">
          <Stat k="Device latency" v={lat ? lat.total_ms.toFixed(1) : '—'} unit="ms" />
          <Stat k="DSP per block" v={lat ? lat.dsp_ms.toFixed(2) : '—'} unit="ms" />
          <Stat k="Engine CPU" v={lat ? Math.round(lat.cpu * 100) : '—'} unit="%" />
        </div>

        {!engine.connected && (
          <div className="banner"><Info size={16} /><span>Starting the audio engine. If this stays here, run <code>pip install -r requirements.txt</code> and restart.</span></div>
        )}
        {engine.connected && !hasBlackHole && (
          <div className="banner">
            <Info size={16} />
            <span>
              Install BlackHole 2ch so Discord, Zoom and games can hear the changed voice.{' '}
              <a onClick={() => window.electronAPI?.openExternal('https://existential.audio/blackhole/')}>Get BlackHole</a>
            </span>
          </div>
        )}
      </motion.div>

      <motion.button className="scroll-cue" style={{ opacity }} onClick={() => onNav('characters')}>
        <span /> Scroll for voices <ArrowDown size={12} />
      </motion.button>
    </section>
  );
}

function Stat({ k, v, unit }) {
  return (
    <div className="stat">
      <span className="v">{v}<small>{unit}</small></span>
      <span className="k">{k}</span>
    </div>
  );
}
