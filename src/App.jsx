import { useEffect, useMemo } from 'react';
import { useEngine, findVoice } from './lib/engine';
import { motion as shared, hexToRgb01 } from './lib/motion';
import { useSmoothScroll } from './hooks/useSmoothScroll';
import AuroraCanvas from './components/AuroraCanvas';
import TitleBar from './components/TitleBar';
import Hero from './components/Hero';
import Characters from './components/Characters';
import Effects from './components/Effects';
import Soundboard from './components/Soundboard';
import VoiceLab from './components/VoiceLab';
import Setup from './components/Setup';
import Dock from './components/Dock';

export const SECTIONS = [
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

  // Feed the active voice colour to the WebGL scene.
  useEffect(() => { shared.tint = hexToRgb01(voice?.color || '#b855e7'); }, [voice]);

  const platform = window.electronAPI?.platform || 'darwin';

  return (
    <div className={`platform-${platform === 'win32' ? 'win' : 'mac'}`}>
      <AuroraCanvas />
      <TitleBar sections={SECTIONS} active={active} onNav={scrollTo} engine={engine} />
      <main className="page">
        <Hero engine={engine} voice={voice} onNav={scrollTo} />
        <Characters engine={engine} />
        <Effects engine={engine} />
        <Soundboard />
        <VoiceLab />
        <Setup engine={engine} />
        <footer className="footer">
          <span>Aurora Voice 0.1 · DSP engine, 48 kHz / 256-sample blocks</span>
          <span>F1 voice on/off · F4 show/hide</span>
        </footer>
      </main>
      <Dock engine={engine} voice={voice} />
    </div>
  );
}
