import { motion } from 'framer-motion';

export default function TitleBar({ sections, active, onNav, engine }) {
  const state = !engine.connected ? 'off' : engine.running ? 'live' : 'ready';
  const label = { off: 'Engine offline', live: engine.bypass ? 'Voice off' : 'Live', ready: 'No output' }[state];
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
      <div className={`conn ${state}`}><i />{label}</div>
    </header>
  );
}
