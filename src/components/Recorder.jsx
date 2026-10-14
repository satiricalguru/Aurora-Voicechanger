import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Circle, Square, Play, Pause, History, Mic, MonitorSpeaker, FolderOpen, Trash2, Scissors, LayoutGrid, X, AlertTriangle } from 'lucide-react';
import { actions, live, fmtTime } from '../lib/engine';
import { RevealLines, FadeUp } from './Reveal';

const isDesktop = !!window.electronAPI?.revealRecording;
const SOURCES = [
  { id: 'voice', label: 'My voice', icon: Mic, hint: 'What your call hears: the changed voice and the soundboard.' },
  { id: 'mac', label: 'Mac audio', icon: MonitorSpeaker, hint: 'Sound from other apps, like YouTube or a game. Your own voice is left out.' },
];
const LENGTHS = [10, 30, 60];
const PRIVACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

export default function Recorder({ engine }) {
  const st = engine.rec;
  const [source, setSource] = useState(null);
  const recSource = source || st?.replay?.record_source || 'voice';
  const recording = !!st?.recording;
  const replay = st?.replay || { replay_enabled: true, replay_source: 'voice', replay_seconds: 30, buffered: 0 };

  const toggleRecord = () => (recording ? actions.recordStop() : actions.recordStart(recSource));

  return (
    <section id="recorder" className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow">03 · Recorder</div>
          <RevealLines className="h-section" lines={['Catch the moment.', <span className="dim" key="d">Keep it forever.</span>]} />
          <FadeUp>
            <p className="lede">
              Record what your call hears, or anything playing on your Mac. Instant Replay keeps the last moments, so you can save them after they happen.
            </p>
          </FadeUp>
        </div>
      </div>

      {st && !st.supported && (
        <div className="banner banner-bad" style={{ marginBottom: 18 }}><AlertTriangle size={16} /><span>The recorder needs the native engine (build it with <code>npm run build:native</code>).</span></div>
      )}
      {(engine.recError || st?.error) && (
        <div className="banner banner-bad" style={{ marginBottom: 18 }}>
          <X size={16} /><span>{engine.recError || st.error}</span>
          {st?.mac_permission === 1 && isDesktop && <a onClick={() => window.electronAPI.openExternal(PRIVACY_URL)}>Open settings</a>}
          {engine.recError && <a onClick={actions.clearRecError}>Dismiss</a>}
        </div>
      )}
      {st?.mac_pending && (
        <div className="banner" style={{ marginBottom: 18 }}>
          <MonitorSpeaker size={16} />
          <span>macOS is asking whether Aurora Voice may record your Mac’s audio. Choose <b>Allow</b> in the dialog to use Mac audio.</span>
        </div>
      )}
      {st?.mac_silent && !st?.mac_pending && (
        <div className="banner" style={{ marginBottom: 18 }}>
          <AlertTriangle size={16} />
          <span>
            Not hearing any Mac audio yet. If something is playing, allow Aurora Voice under System Settings › Privacy &amp; Security › Screen &amp; System Audio Recording.{' '}
            {isDesktop && <a onClick={() => window.electronAPI.openExternal(PRIVACY_URL)}>Open settings</a>}
          </span>
        </div>
      )}

      <FadeUp>
        <div className="rec-grid">
          <div className={`panel rec-card ${recording ? 'live' : ''}`}>
            <div className="rec-card-head">
              <div>
                <h3>Recorder</h3>
                <p className="sub">{SOURCES.find(s => s.id === (recording ? st.source : recSource))?.hint}</p>
              </div>
              <kbd className="rec-key" title="Works while Aurora Voice is in the background">F6</kbd>
            </div>
            <SourcePicker value={recording ? st.source : recSource} disabled={recording} onChange={setSource} />
            <div className="rec-main">
              <button className={`rec-button ${recording ? 'on' : ''}`} onClick={toggleRecord} disabled={st && !st.supported}
                aria-label={recording ? 'Stop recording' : 'Start recording'} aria-pressed={recording}>
                {recording ? <Square size={22} fill="currentColor" /> : <Circle size={26} fill="currentColor" />}
              </button>
              <div className="rec-readout">
                <div className="rec-time">{recording ? fmtTime(st.seconds) : '0:00'}</div>
                <div className="rec-state">{recording ? <><i className="rec-dot" /> Recording</> : 'Ready'}</div>
              </div>
              <LevelMeter source={recording ? st.source : recSource} />
            </div>
          </div>

          <div className={`panel rec-card ${replay.replay_enabled ? '' : 'off'}`}>
            <div className="rec-card-head">
              <div>
                <h3>Instant Replay</h3>
                <p className="sub">Always listening in memory. Nothing is saved until you press Save.</p>
              </div>
              <button className={`switch ${replay.replay_enabled ? 'on' : ''}`} onClick={() => actions.setReplay({ replay_enabled: !replay.replay_enabled })}
                aria-label="Instant Replay" aria-pressed={replay.replay_enabled} />
            </div>
            <SourcePicker value={replay.replay_source} disabled={!replay.replay_enabled} onChange={(v) => actions.setReplay({ replay_source: v })} />
            <div className="rec-lengths" role="group" aria-label="Replay length">
              {LENGTHS.map(l => (
                <button key={l} className={`chip ${replay.replay_seconds === l ? 'on' : ''}`} disabled={!replay.replay_enabled}
                  aria-pressed={replay.replay_seconds === l} onClick={() => actions.setReplay({ replay_seconds: l })}>{l} s</button>
              ))}
            </div>
            <div className="rec-main">
              <button className="btn btn-primary btn-lg" onClick={actions.saveReplay} disabled={!replay.replay_enabled || replay.buffered < 0.5}>
                <History size={16} /> Save last {replay.replay_seconds} s <kbd>F5</kbd>
              </button>
              <div className="replay-buffer" title="How much is in memory right now">
                <div className="track"><div className="fill" style={{ width: `${Math.min(100, (replay.buffered / replay.replay_seconds) * 100)}%` }} /></div>
                <small>{replay.replay_enabled ? `${Math.floor(replay.buffered)} / ${replay.replay_seconds} s ready` : 'Off'}</small>
              </div>
            </div>
          </div>
        </div>
      </FadeUp>

      <h4 className="sb-group">Your recordings{engine.recordings.length ? ` · ${engine.recordings.length}` : ''}</h4>
      {engine.recordings.length === 0
        ? <div className="rec-empty">Recordings and replays you save show up here. Trim any of them into a soundboard pad.</div>
        : <RecordingList items={engine.recordings} />}
    </section>
  );
}

function SourcePicker({ value, onChange, disabled }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Source">
      {SOURCES.map(s => (
        <button key={s.id} role="radio" aria-checked={value === s.id} className={value === s.id ? 'on' : ''} disabled={disabled} onClick={() => onChange(s.id)}>
          <s.icon size={14} /> {s.label}
        </button>
      ))}
    </div>
  );
}

// Peak meter for a capture source, animated outside React.
function LevelMeter({ source }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf;
    const loop = () => {
      const v = Math.min(1, Math.sqrt(live.rec[source] || 0) * 1.1);
      if (ref.current) ref.current.style.transform = `scaleX(${v.toFixed(3)})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [source]);
  return <div className="rec-level" aria-hidden="true"><div className="fill" ref={ref} /></div>;
}

function RecordingList({ items }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(null);  // { id, end? }
  const [trim, setTrim] = useState(null);        // recording id being trimmed

  useEffect(() => () => audio.current?.pause(), []);

  async function play(r, from = 0, to = null) {
    if (playing?.id === r.id && from === 0 && to === null) { audio.current?.pause(); setPlaying(null); return; }
    try {
      const url = await actions.recordingUrl(r.id);
      if (!audio.current) audio.current = new Audio();
      const a = audio.current;
      a.pause();
      a.src = url;
      a.currentTime = from;
      a.onended = () => setPlaying(null);
      a.ontimeupdate = () => { if (to !== null && a.currentTime >= to) { a.pause(); setPlaying(null); } };
      await a.play();
      setPlaying({ id: r.id, from, to });
    } catch {
      setPlaying(null);
    }
  }

  return (
    <ul className="rec-list">
      <AnimatePresence initial={false}>
        {items.map(r => (
          <motion.li key={r.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className={`rec-item ${trim === r.id ? 'trimming' : ''}`} style={{ '--c': r.source === 'mac' ? 'var(--signal)' : 'var(--lavender)' }}>
            <RecordingRow r={r} playing={playing?.id === r.id ? playing : null} audio={audio} onPlay={() => play(r)}
              trimming={trim === r.id} onTrim={() => setTrim(trim === r.id ? null : r.id)}
              onPlayRange={(a, b) => play(r, a, b)} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function RecordingRow({ r, playing, audio, onPlay, trimming, onTrim, onPlayRange }) {
  const [name, setName] = useState(r.name);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [range, setRange] = useState([0, Math.min(r.duration, 120)]);
  const head = useRef(null);

  useEffect(() => setName(r.name), [r.name]);
  useEffect(() => { if (!confirmDel) return undefined; const t = setTimeout(() => setConfirmDel(false), 3000); return () => clearTimeout(t); }, [confirmDel]);
  useEffect(() => { if (trimming) setRange([0, Math.min(r.duration, 120)]); }, [trimming, r.duration]);

  // Playhead follows the shared audio element while this row plays.
  useEffect(() => {
    if (!playing) { if (head.current) head.current.style.opacity = 0; return undefined; }
    let raf;
    const loop = () => {
      const a = audio.current;
      if (a && head.current) {
        head.current.style.opacity = 1;
        head.current.style.left = `${Math.min(100, (a.currentTime / r.duration) * 100)}%`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, audio, r.duration]);

  const commit = () => { setEditing(false); if (name.trim() && name.trim() !== r.name) actions.renameRecording(r.id, name.trim()); else setName(r.name); };
  const when = new Date(r.created * 1000);
  const tooLong = range[1] - range[0] > 120;

  return (
    <>
      <div className="rec-row">
        <button className={`rec-play ${playing ? 'on' : ''}`} onClick={onPlay} aria-label={playing ? `Pause ${r.name}` : `Play ${r.name}`}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <div className="rec-info">
          {editing
            ? <input className="input" autoFocus value={name} maxLength={60} onChange={e => setName(e.target.value)} onBlur={commit}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(r.name); setEditing(false); } }} aria-label="Recording name" />
            : <button className="rec-name" onClick={() => setEditing(true)} title="Rename">{r.name}</button>}
          <div className="rec-meta">
            <span className="rec-tag">{r.kind === 'replay' ? 'Replay' : 'Recording'}</span>
            {r.source === 'mac' ? 'Mac audio' : 'My voice'} · {fmtTime(r.duration)} · {when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            {r.silent && <span className="rec-warn"> · silent</span>}
          </div>
        </div>
        <div className="rec-wave" aria-hidden="true">
          <Wave peaks={r.peaks} />
          <i className="rec-head" ref={head} />
        </div>
        <div className="rec-actions">
          <button className={`chip ${trimming ? 'on' : ''}`} onClick={onTrim} title="Trim and add to the soundboard"><LayoutGrid size={13} /> To soundboard</button>
          {isDesktop && <button className="icon-btn" onClick={() => window.electronAPI.revealRecording(r.path)} title="Show in Finder" aria-label={`Show ${r.name} in Finder`}><FolderOpen size={15} /></button>}
          <button className={`icon-btn ${confirmDel ? 'danger' : ''}`} onClick={() => (confirmDel ? actions.deleteRecording(r.id) : setConfirmDel(true))}
            title={confirmDel ? 'Click again to delete' : 'Delete'} aria-label={confirmDel ? `Confirm delete ${r.name}` : `Delete ${r.name}`}>
            {confirmDel ? <span className="confirm">Delete?</span> : <Trash2 size={15} />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {trimming && (
          <motion.div className="rec-trim" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="trim-wave">
              <Wave peaks={r.peaks} />
              <div className="trim-shade" style={{ left: 0, width: `${(range[0] / r.duration) * 100}%` }} />
              <div className="trim-shade" style={{ left: `${(range[1] / r.duration) * 100}%`, right: 0 }} />
              <input type="range" min={0} max={r.duration} step={0.01} value={range[0]} aria-label="Start"
                onChange={e => setRange([Math.min(+e.target.value, range[1] - 0.05), range[1]])} />
              <input type="range" min={0} max={r.duration} step={0.01} value={range[1]} aria-label="End"
                onChange={e => setRange([range[0], Math.max(+e.target.value, range[0] + 0.05)])} />
            </div>
            <div className="trim-bar">
              <span className="trim-times"><Scissors size={13} /> {range[0].toFixed(2)} s – {range[1].toFixed(2)} s · <b>{(range[1] - range[0]).toFixed(2)} s</b>
                {tooLong && <span className="rec-warn"> · pads can be up to 2 min</span>}</span>
              <button className="btn btn-ghost" onClick={() => onPlayRange(range[0], range[1])}><Play size={13} fill="currentColor" /> Play selection</button>
              <button className="btn btn-primary" disabled={tooLong} onClick={() => { actions.recordingToSound(r.id, range[0], range[1], r.name); onTrim(); }}>
                <LayoutGrid size={14} /> Add to soundboard
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Wave({ peaks }) {
  const n = peaks?.length || 0;
  return (
    <svg viewBox={`0 0 ${n * 3} 40`} preserveAspectRatio="none">
      {(peaks || []).map((p, i) => {
        const h = Math.max(2, p * 38);
        return <rect key={i} x={i * 3} y={20 - h / 2} width={2} height={h} rx={1} />;
      })}
    </svg>
  );
}
