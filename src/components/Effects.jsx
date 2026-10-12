import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { actions } from '../lib/engine';
import { RevealLines, FadeUp, staggerParent, staggerChild } from './Reveal';
import Avatar from './Avatar';

export default function Effects({ engine }) {
  const [cat, setCat] = useState('All');
  const cats = useMemo(() => {
    const seen = [];
    engine.dspVoices.forEach(v => { if (v.category !== 'None' && !seen.includes(v.category)) seen.push(v.category); });
    return ['All', ...seen];
  }, [engine.dspVoices]);

  const groups = useMemo(() => {
    const map = new Map();
    engine.dspVoices
      .filter(v => (cat === 'All' || v.category === cat))
      .forEach(v => {
        const k = v.category === 'None' ? 'Clean' : v.category;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(v);
      });
    return [...map.entries()];
  }, [engine.dspVoices, cat]);

  return (
    <section id="effects" className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow">02 · Effects</div>
          <RevealLines className="h-section" lines={['Fifty effects,', <span className="dim" key="d">almost no added delay.</span>]} />
          <FadeUp><p className="lede">Robots, radios, caves, demons and pitch tricks. Pure DSP, so they add almost no delay on top of your audio device.</p></FadeUp>
        </div>
      </div>
      <FadeUp>
        <div className="chips" style={{ marginBottom: 28 }}>
          {cats.map(c => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      </FadeUp>

      {groups.map(([name, voices]) => (
        <div className="fx-group" key={name + cat}>
          <h4>{name}</h4>
          <motion.div className="grid-fx" variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-5% 0px' }}>
            {voices.map(v => (
              <motion.button
                key={v.id}
                variants={staggerChild}
                className={`fxcard ${engine.activeVoice === v.id ? 'on' : ''}`}
                onClick={() => actions.setVoice(v.id)}
                whileTap={{ scale: 0.97 }}
              >
                <Avatar voice={v} size={30} />
                <span>
                  <span className="n">{v.name}</span><br />
                  <span className="c">{v.category === 'None' ? 'no effect' : v.category.toLowerCase()}</span>
                </span>
              </motion.button>
            ))}
          </motion.div>
        </div>
      ))}
    </section>
  );
}
