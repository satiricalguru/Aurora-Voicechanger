import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useEngine, findVoice, actions } from './lib/engine';
import { motion as shared, hexToRgb01 } from './lib/motion';
import { useSmoothScroll } from './hooks/useSmoothScroll';
import { DEMO_MODE, SHOWCASE_VOICE, isSetupComplete, findBlackHole, pickRealMic } from './lib/demo';
import AuroraCanvas from './components/AuroraCanvas';
import TitleBar from './components/TitleBar';
import Hero from './components/Hero';
import Characters from './components/Characters';
import Effects from './components/Effects';
import Soundboard from './components/Soundboard';
import VoiceLab from './components/VoiceLab';
import Setup from './components/Setup';
import Dock from './components/Dock';
import FirstRunSheet from './components/FirstRunSheet';

export const SECTIONS = DEMO_MODE
  ? [
      { id: 'home', label: 'Live' },
      { id: 'characters', label: 'Characters' },
      { id: 'setup', label: 'Setup' },
    ]
  : [
      { id: 'home', label: 'Live' },
      { id: 'characters', label: 'Characters' },
      { id: 'effects', label: 'Effects' },
      { id: 'soundboard', label: 'Soundboard' },
      { id: 'lab', label: 'Lab' },
      { id: 'setup', label: 'Setup' },
    ];

export default function App() {
  const engine = useEngine();
  const { active, scrollTo } = useSmoothScroll(SECTIONS.map(s => s.id));
  const voice = useMemo(() => findVoice(engine, engine.activeVoice), [engine]);
  const [setupOpen, setSetupOpen] = useState(() => !isSetupComplete());
  const [autoRouted, setAutoRouted] = useState(false);
  const [showcaseSet, setShowcaseSet] = useState(false);

  useEffect(() => { shared.tint = hexToRgb01(voice?.color || '#b855e7'); }, [voice]);

  // Auto-select BlackHole + real mic when devices arrive and route is empty.
  useEffect(() => {
    if (!engine.connected || !engine.devices.length || autoRouted) return;
    const bh = findBlackHole(engine.devices);
    const mic = pickRealMic(engine.devices);
    if (!bh || !mic) return;
    const needIn = engine.route.input == null;
    const needOut = engine.route.output == null;
    if (needIn || needOut) {
      actions.setDevices(mic.index, bh.index);
    }
    setAutoRouted(true);
  }, [engine.connected, engine.devices, engine.route, autoRouted]);

  // Preselect showcase character once voices are available.
  useEffect(() => {
    if (!engine.connected || showcaseSet || engine.activeVoice) return;
    const has = engine.aiVoices.some(v => v.id === SHOWCASE_VOICE);
    if (!has) return;
    actions.setVoice(SHOWCASE_VOICE);
    setShowcaseSet(true);
  }, [engine.connected, engine.aiVoices, engine.activeVoice, showcaseSet]);

  // Re-open first-run if BH goes missing after setup was marked complete.
  useEffect(() => {
    if (!engine.connected || !engine.devices.length) return;
    if (!findBlackHole(engine.devices) && isSetupComplete()) setSetupOpen(true);
  }, [engine.connected, engine.devices]);

  const platform = window.electronAPI?.platform || 'darwin';
  const showSheet = setupOpen || (engine.connected && engine.devices.length > 0 && !findBlackHole(engine.devices) && !isSetupComplete());

  return (
    <div className={`platform-${platform === 'win32' ? 'win' : 'mac'}${showSheet ? ' sheet-open' : ''}`}>
      <AuroraCanvas />
      <TitleBar sections={SECTIONS} active={active} onNav={scrollTo} engine={engine} />
      <main className="page">
        <Hero engine={engine} voice={voice} onNav={scrollTo} onOpenSetup={() => setSetupOpen(true)} />
        <Characters engine={engine} />
        {!DEMO_MODE && <Effects engine={engine} />}
        {!DEMO_MODE && <Soundboard />}
        {!DEMO_MODE && <VoiceLab />}
        <Setup engine={engine} demo={DEMO_MODE} onOpenSetup={() => setSetupOpen(true)} />
        <footer className="footer">
          <span>Aurora Voice 0.1 · character DSP · local on your Mac</span>
          <span>F1 voice · F2 hear myself · F4 show/hide</span>
        </footer>
      </main>
      <Dock engine={engine} voice={voice} onOpenSetup={() => setSetupOpen(true)} />
      <AnimatePresence>
        {showSheet && (
          <FirstRunSheet
            key="firstrun"
            engine={engine}
            onDone={() => setSetupOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
