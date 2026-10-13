import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { Power, Headphones, ArrowDown, Info, AlertTriangle, MicOff, Mic } from 'lucide-react';
import { actions } from '../lib/engine';
import { findVirtualMic } from '../lib/demo';
import { faceFor } from '../lib/faces';

const ease = [0.16, 1, 0.3, 1];

export default function Hero({ engine, voice, onNav, onOpenSetup }) {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 900], [0, -180]);
  const opacity = useTransform(scrollY, [0, 520], [1, 0]);
  const portraitScale = useTransform(scrollY, [0, 520], [1, 0.82]);
  const blur = useTransform(scrollY, [0, 520], ['blur(0px)', 'blur(8px)']);

  const name = voice?.name || 'Your voice';
  const sub = voice
    ? (voice.description || `${voice.category} character`)
    : 'Pick a voice below. Everything runs locally on your Mac.';
  const face = voice ? faceFor(voice.id) : null;
  const vm = findVirtualMic(engine.devices);
  const on = engine.running && !engine.bypass;
  const routeLabel = vm
    ? `Sending to ${vm.name}`
    : engine.connected
      ? 'No virtual mic — finish Setup'
      : null;

  return (
    <section id="home" className="section hero">
      {/* Portrait sits inside the audio-reactive sphere (see gl/AuroraScene.js). */}
      {/* Outer layer follows the scroll; inner layer animates voice changes. */}
      <motion.div className="hero-portrait-anchor" style={{ opacity, scale: portraitScale }}>
        <AnimatePresence>
          {face && (
            <motion.div
              key={voice.id}
              className="hero-portrait"
              style={{ '--c': voice.color || '#b855e7' }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.45, ease }}
            >
              <img src={face} alt="" draggable="false" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
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
            <Headphones size={16} /> {engine.monitoring ? 'Hearing myself' : 'Hear myself'} <kbd>F2</kbd>
          </button>
          <button className={`btn btn-ghost btn-lg ${engine.muted ? 'on danger' : ''}`} onClick={actions.toggleMute} disabled={!engine.connected} aria-pressed={engine.muted}>
            {engine.muted ? <MicOff size={16} /> : <Mic size={16} />} {engine.muted ? 'Muted' : 'Mute'} <kbd>F3</kbd>
          </button>
        </div>

        {routeLabel && (
          <p className={`hero-route ${vm ? 'ok' : 'warn'}`}>{routeLabel}</p>
        )}

        {!engine.connected && (
          <div className="banner"><Info size={16} /><span>Starting the audio engine. If this stays here, run <code>pip install -r requirements.txt</code> and restart.</span></div>
        )}
        {engine.connected && !vm && (
          <div className="banner">
            <Info size={16} />
            <span>
              Install Aurora Microphone so Discord, Zoom and games can hear the changed voice.{' '}
              <a onClick={actions.installVirtualMic}>Install</a>
              {' · '}
              <a onClick={onOpenSetup}>Open setup</a>
            </span>
          </div>
        )}
        {engine.lastError && (
          <div className="banner banner-bad">
            <AlertTriangle size={16} />
            <span>{engine.lastError}</span>
          </div>
        )}
      </motion.div>

      <motion.button className="scroll-cue" style={{ opacity }} onClick={() => onNav('voices')}>
        <span /> Scroll for voices <ArrowDown size={12} />
      </motion.button>
    </section>
  );
}
