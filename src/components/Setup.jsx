import { RefreshCw } from 'lucide-react';
import { actions } from '../lib/engine';
import { RevealLines, FadeUp } from './Reveal';
import { Slider } from './VoiceLab';

export default function Setup({ engine }) {
  const { devices, settings: s, route } = engine;
  const inputs = devices.filter(d => d.inputs > 0 && !d.is_blackhole);
  const outputs = devices.filter(d => d.outputs > 0);
  const bh = devices.find(d => d.is_blackhole && d.outputs > 0);
  const defIn = devices.find(d => d.is_default_input && d.inputs > 0);
  const curIn = route.input ?? defIn?.index ?? '';
  const curOut = route.output ?? bh?.index ?? '';

  const pick = (inp, out) => { if (inp !== '' && out !== '') actions.setDevices(Number(inp), Number(out)); };
  const pct = (v) => `${Math.round(v * 100)}%`;

  return (
    <section id="setup" className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow">05 · Setup</div>
          <RevealLines className="h-section" lines={['Routing and', <span className="dim" key="d">levels.</span>]} />
          <FadeUp><p className="lede">Pick “BlackHole 2ch” as the output here, then pick it as the microphone in Discord, Zoom or your game.</p></FadeUp>
        </div>
      </div>

      <FadeUp className="two-col">
        <div className="panel">
          <h3>Devices</h3>
          <p className="sub">Your mic goes in, the changed voice goes out.</p>
          <div className="field">
            <label>Microphone</label>
            <select className="select" value={curIn} onChange={e => pick(e.target.value, curOut)}>
              <option value="" disabled>Choose a microphone</option>
              {inputs.map(d => <option key={d.index} value={d.index}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Send changed voice to</label>
            <select className="select" value={curOut} onChange={e => pick(curIn, e.target.value)}>
              <option value="" disabled>Choose an output</option>
              {outputs.map(d => <option key={d.index} value={d.index}>{d.name}{d.is_blackhole ? '  (virtual mic)' : ''}</option>)}
            </select>
          </div>
          {!bh && <p className="device-warning">BlackHole 2ch isn't installed, so other apps can't hear the changed voice yet.</p>}
          <button className="btn btn-ghost" onClick={actions.rescan}><RefreshCw size={14} /> Rescan devices</button>
        </div>

        <div className="panel">
          <h3>Levels</h3>
          <p className="sub">Changes apply instantly.</p>
          <Slider p={{ label: 'Mic gain', min: 0, max: 2, step: 0.01 }} value={s.vol_mic} format={pct} onChange={v => actions.updateSettings({ vol_mic: v })} />
          <Slider p={{ label: 'Voice output', min: 0, max: 2, step: 0.01 }} value={s.vol_voice} format={pct} onChange={v => actions.updateSettings({ vol_voice: v })} />
          <Slider p={{ label: 'Hear myself', min: 0, max: 1.5, step: 0.01 }} value={s.vol_monitor} format={pct} onChange={v => actions.updateSettings({ vol_monitor: v })} />
          <Slider p={{ label: 'Soundboard', min: 0, max: 1.5, step: 0.01 }} value={s.vol_sound} format={pct} onChange={v => actions.updateSettings({ vol_sound: v })} />
        </div>

        <div className="panel">
          <h3>Clean-up</h3>
          <p className="sub">Keep keyboard clicks and fan noise out of the call.</p>
          <Toggle label="Noise gate" hint="Mutes the mic below the threshold" on={s.noise_gate_enabled} onClick={() => actions.updateSettings({ noise_gate_enabled: !s.noise_gate_enabled })} />
          <Toggle label="Noise reduction" hint="Learns your room noise while you're quiet" on={s.noise_reduction_enabled} onClick={() => actions.updateSettings({ noise_reduction_enabled: !s.noise_reduction_enabled })} />
          <div style={{ marginTop: 12 }}>
            <Slider p={{ label: 'Gate threshold', min: -80, max: -10, step: 1 }} value={s.noise_gate_level} format={v => `${v} dB`} onChange={v => actions.updateSettings({ noise_gate_level: v })} />
          </div>
        </div>

        <div className="panel">
          <h3>Latency</h3>
          <p className="sub">Reported by the audio device for the live stream.</p>
          <LatencyTable lat={engine.latency} />
        </div>
      </FadeUp>
    </section>
  );
}

function Toggle({ label, hint, on, onClick }) {
  return (
    <div className="toggle-row">
      <span className="l">{label}<small>{hint}</small></span>
      <button className={`switch ${on ? 'on' : ''}`} onClick={onClick} role="switch" aria-checked={on} aria-label={label} />
    </div>
  );
}

function LatencyTable({ lat }) {
  if (!lat) return <div className="empty">No stream running yet.</div>;
  const rows = [
    ['Input buffer', `${lat.input_ms.toFixed(1)} ms`],
    ['Processing block', `${lat.block_ms.toFixed(1)} ms`],
    ['Output buffer', `${lat.output_ms.toFixed(1)} ms`],
    ['Total (device side)', `${lat.total_ms.toFixed(1)} ms`],
    ['DSP time per block', `${lat.dsp_ms.toFixed(2)} ms`],
    ['Dropouts', String(lat.xruns)],
  ];
  return rows.map(([k, v], i) => (
    <div className="toggle-row" key={k} style={i === 3 ? { fontWeight: 600 } : undefined}>
      <span className="l">{k}</span><span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{v}</span>
    </div>
  ));
}
