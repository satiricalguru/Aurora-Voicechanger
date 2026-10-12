import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
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

      <motion.div className="face-grid" variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-5% 0px' }} key={tag}>
        {list.map(v => {
          const on = engine.activeVoice === v.id;
          const src = faceFor(v.id);
          return (
            <motion.button
              key={v.id}
              variants={staggerChild}
              className={`face-item ${on ? 'on' : ''}`}
              style={{ '--c': v.color }}
              onClick={() => actions.setVoice(v.id)}
              title={v.description}
              aria-pressed={on}
            >
              <span className="face-ring">
                {src
                  ? <img src={src} alt="" loading="lazy" draggable="false" />
                  : <Orb color={v.color} size={92} />}
                <span className="face-badge">AI</span>
                {on && <span className="face-live" aria-label="Active" />}
              </span>
              <span className="face-name">{v.name}</span>
              <span className="face-tag">{LABEL[v.tag] || v.tag}</span>
            </motion.button>
          );
        })}
      </motion.div>

      <p className="note"><Sparkles size={13} /> These run on the DSP engine today. Neural voice models (Beatrice 2) slot in here next for true voice conversion.</p>
    </section>
  );
}
