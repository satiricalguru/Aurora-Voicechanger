import { motion } from 'framer-motion';
import { findBlackHole } from '../lib/demo';

export default function TitleBar({ sections, active, onNav, engine }) {
  let state = 'off';
  let label = 'Engine offline';
  if (engine.connected) {
    if (engine.running && !engine.bypass) {
      state = 'live';
      label = 'Live';
    } else if (engine.running && engine.bypass) {
      state = 'ready';
      label = 'Voice off';
    } else if (!findBlackHole(engine.devices)) {
      state = 'ready';
      label = 'Need BlackHole';
    } else {
      state = 'ready';
      label = 'Ready';
    }
  }
  if (engine.lastError) {
    state = 'off';
    label = 'Error';
  }

  return (
    <header className="titlebar">
      <div className="brand"><span className="brand-dot" />Aurora Voice</div>
      <nav className="nav" aria-label="Sections">
        {sections.map(s => (
          <button key={s.id} className={active === s.id ? 'on' : ''} onClick={() => onNav(s.id)}>
            {active === s.id && (
              <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
            )}
            {s.label}
          </button>
        ))}
      </nav>
      <div className={`conn ${state}`} title={engine.lastError || undefined}><i />{label}</div>
    </header>
  );
}
