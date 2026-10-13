import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Star, X } from 'lucide-react';
import { actions } from '../lib/engine';
import { RevealLines, FadeUp, staggerParent, staggerChild } from './Reveal';
import Orb from './Orb';
import { faceFor } from '../lib/faces';

// One library for every voice, like Voicemod's: characters, AI voices and
// effects side by side, with search, filters and favourites.
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'fav', label: 'Favorites' },
  { id: 'ai', label: 'AI' },
  { id: 'ANIME', label: 'Anime' },
  { id: 'REALISTIC', label: 'Real people' },
  { id: 'DARK', label: 'Dark' },
  { id: 'CREATURE', label: 'Creatures' },
  { id: 'fx', label: 'Effects' },
];
const TAG_LABEL = { ANIME: 'Anime', REALISTIC: 'Real', DARK: 'Dark', CREATURE: 'Creature', AI: 'AI' };
const FAV_KEY = 'aurora.favorites.v1';

function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); }
}

export default function Voices({ engine }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState(loadFavs);

  const all = useMemo(() => [
    ...engine.aiVoices.map(v => ({ ...v, group: v.type === 'neural' ? 'ai' : v.tag, badge: v.type === 'neural' ? 'AI' : TAG_LABEL[v.tag] || '' })),
    ...engine.dspVoices.map(v => ({ ...v, group: 'fx', badge: v.id === 'bypass' ? 'Clean' : v.category })),
  ], [engine.aiVoices, engine.dspVoices]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(v => {
      if (filter === 'fav' && !favs.has(v.id)) return false;
      if (filter !== 'all' && filter !== 'fav' && v.group !== filter) return false;
      if (!q) return true;
      return [v.name, v.description, v.category, v.badge].some(t => (t || '').toLowerCase().includes(q));
    });
  }, [all, filter, query, favs]);

  const toggleFav = (id) => {
    setFavs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  };

  return (
    <section id="voices" className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow">01 · Voices</div>
          <RevealLines className="h-section" lines={[`${all.length} voices,`, <span className="dim" key="d">one tap away.</span>]} />
          <FadeUp><p className="lede">Characters, AI voices and effects. Tap one and talk; star the ones you use most.</p></FadeUp>
        </div>
      </div>

      <FadeUp>
        <div className="library-bar">
          <label className="search">
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search voices" aria-label="Search voices" />
            {query && <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
          </label>
          <div className="chips" role="group" aria-label="Filter voices">
            {FILTERS.map(f => (
              <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}{f.id === 'fav' && favs.size ? ` · ${favs.size}` : ''}
              </button>
            ))}
          </div>
        </div>
      </FadeUp>

      {list.length === 0 && (
        <div className="empty-state">
          {filter === 'fav' ? 'No favorites yet. Star a voice to keep it here.' : `No voices match “${query}”.`}
        </div>
      )}

      <motion.div className="face-grid" variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-5% 0px' }} key={`${filter}|${query}`}>
        {list.map(v => {
          const on = engine.activeVoice === v.id;
          const src = faceFor(v.id);
          const fav = favs.has(v.id);
          return (
            <motion.div key={v.id} variants={staggerChild} className={`face-item ${on ? 'on' : ''}`} style={{ '--c': v.color }}>
              <button className="face-hit" onClick={() => actions.setVoice(v.id)} title={v.description || v.name} aria-pressed={on} aria-label={`Use ${v.name}`}>
                <span className="face-ring">
                  {src
                    ? <img src={src} alt="" loading="lazy" draggable="false" />
                    : <Orb color={v.color} size={112} />}
                  {on && <span className="face-live" aria-hidden="true" />}
                </span>
                <span className="face-name">{v.name}</span>
                {v.badge && <span className="face-tag">{v.badge}</span>}
              </button>
              <button className={`face-fav ${fav ? 'on' : ''}`} onClick={() => toggleFav(v.id)} aria-pressed={fav} aria-label={fav ? `Remove ${v.name} from favorites` : `Add ${v.name} to favorites`}>
                <Star size={14} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </motion.div>
          );
        })}
      </motion.div>
    </section>
  );
}
