import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { actions } from '../lib/engine';
import { RevealLines, FadeUp, staggerParent, staggerChild } from './Reveal';
import Orb from './Orb';
import { faceFor } from '../lib/faces';

const TAGS = ['All', 'ANIME', 'REALISTIC', 'DARK', 'CREATURE'];
const LABEL = { All: 'All', ANIME: 'Anime', REALISTIC: 'Real people', DARK: 'Dark', CREATURE: 'Creatures' };

export default function Characters({ engine }) {
  const [tag, setTag] = useState('All');
  const list = useMemo(
    () => engine.aiVoices.filter(v => tag === 'All' || v.tag === tag),
    [engine.aiVoices, tag],
  );

  return (
    <section id="characters" className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow">01 · Characters</div>
          <RevealLines className="h-section" lines={['Anime heroes and', <span className="dim" key="d">real human voices.</span>]} />
          <FadeUp><p className="lede">Each character has its own pitch range, formants, breath and colour. Tap one and talk.</p></FadeUp>
        </div>
        <FadeUp delay={0.1}>
          <div className="chips" role="tablist">
            {TAGS.map(t => (
              <button key={t} className={`chip ${tag === t ? 'on' : ''}`} onClick={() => setTag(t)}>{LABEL[t]}</button>
            ))}
          </div>
        </FadeUp>
      </div>

      <motion.div className="grid-voices" variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-5% 0px' }} key={tag}>
        <AnimatePresence>
          {list.map(v => {
            const on = engine.activeVoice === v.id;
            return (
              <motion.button
                layout
                key={v.id}
                variants={staggerChild}
                className={`vcard ${on ? 'on' : ''}`}
                style={{ '--c': v.color }}
                onClick={() => actions.setVoice(v.id)}
                whileTap={{ scale: 0.98 }}
              >
                {faceFor(v.id)
                  ? <img className="portrait" src={faceFor(v.id)} alt="" loading="lazy" draggable="false" />
                  : <><span className="glow" /><Orb color={v.color} /></>}
                {on && <span className="live-badge">LIVE</span>}
                <span className="tag">{LABEL[v.tag] || v.tag}</span>
                <span className="name">{v.name}</span>
                <span className="desc">{v.description}</span>
              </motion.button>
            );
          })}
        </AnimatePresence>
        {!engine.aiVoices.length && Array.from({ length: 8 }).map((_, i) => (
          <motion.div key={i} variants={staggerChild} className="vcard" style={{ opacity: 0.4 }} />
        ))}
      </motion.div>

      <p className="note"><Sparkles size={13} /> These run on the DSP engine today. Neural voice models (Beatrice 2) slot in here next for true voice conversion.</p>
    </section>
  );
}
