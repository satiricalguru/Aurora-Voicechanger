import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useEngine, findVoice, actions } from './lib/engine';
import { motion as shared, hexToRgb01 } from './lib/motion';
import { useSmoothScroll } from './hooks/useSmoothScroll';
import { SHOWCASE_VOICE, isSetupComplete, findVirtualMic, pickRealMic } from './lib/demo';
import AuroraCanvas from './components/AuroraCanvas';
import TitleBar from './components/TitleBar';
import Hero from './components/Hero';
import Voices from './components/Voices';
import Soundboard from './components/Soundboard';
import VoiceLab from './components/VoiceLab';
import Setup from './components/Setup';
import Dock from './components/Dock';
import FirstRunSheet from './components/FirstRunSheet';

export const SECTIONS = [
  { id: 'home', label: 'Live' },
  { id: 'voices', label: 'Voices' },
  { id: 'soundboard', label: 'Soundboard' },
  { id: 'lab', label: 'Voice Lab' },
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

  // Auto-select the virtual mic + real mic when devices arrive and route is empty.
  useEffect(() => {
    if (!engine.connected || !engine.devices.length || autoRouted) return;
    const vm = findVirtualMic(engine.devices);
    const mic = pickRealMic(engine.devices);
    if (!vm || !mic) return;
    const needIn = engine.route.input == null;
    const needOut = engine.route.output == null;
    if (needIn || needOut) {
      actions.setDevices(mic.index, vm.index);
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
    if (!findVirtualMic(engine.devices) && isSetupComplete()) setSetupOpen(true);
  }, [engine.connected, engine.devices]);

  const platform = window.electronAPI?.platform || 'darwin';
  const showSheet = setupOpen || (engine.connected && engine.devices.length > 0 && !findVirtualMic(engine.devices) && !isSetupComplete());

  return (
    <div className={`platform-${platform === 'win32' ? 'win' : 'mac'}${showSheet ? ' sheet-open' : ''}`}>
      <AuroraCanvas />
      <TitleBar sections={SECTIONS} active={active} onNav={scrollTo} engine={engine} />
      <main className="page">
        <Hero engine={engine} voice={voice} onNav={scrollTo} onOpenSetup={() => setSetupOpen(true)} />
        <Voices engine={engine} />
        <Soundboard engine={engine} />
        <VoiceLab />
        <Setup engine={engine} onOpenSetup={() => setSetupOpen(true)} />
        <footer className="footer">
          <span>Aurora Voice 0.2 · native engine · everything runs on your Mac</span>
          <span>F1 voice · F2 hear myself · F3 mute · F4 show/hide</span>
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
