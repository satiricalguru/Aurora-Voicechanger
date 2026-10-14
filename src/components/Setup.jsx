import { RefreshCw, ExternalLink, Gauge } from 'lucide-react';
import { actions } from '../lib/engine';
import { BH_DOWNLOAD, findVirtualMic, resetSetupComplete } from '../lib/demo';
import { RevealLines, FadeUp } from './Reveal';
import { Slider } from './VoiceLab';

export default function Setup({ engine, onOpenSetup }) {
  const { devices, settings: s, route } = engine;
  const inputs = devices.filter(d => d.inputs > 0 && !d.is_virtual_mic);
  const outputs = devices.filter(d => d.outputs > 0);
  const vm = findVirtualMic(devices);
  const defIn = devices.find(d => d.is_default_input && d.inputs > 0);
  const curIn = route.input ?? defIn?.index ?? '';
  const curOut = route.output ?? vm?.index ?? '';

  const pick = (inp, out) => { if (inp !== '' && out !== '') actions.setDevices(Number(inp), Number(out)); };
  const pct = (v) => `${Math.round(v * 100)}%`;

  return (
    <section id="setup" className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow">05 · Setup</div>
          <RevealLines className="h-section" lines={['Routing and', <span className="dim" key="d">levels.</span>]} />
          <FadeUp>
            <p className="lede">
              Send the changed voice to Aurora Microphone, then pick Aurora Microphone as the microphone in Discord, Zoom or your game.
            </p>
          </FadeUp>
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
              {outputs.map(d => <option key={d.index} value={d.index}>{d.name}{d.is_virtual_mic ? '  (virtual mic)' : ''}</option>)}
            </select>
          </div>
          {!vm && (
            <p className="device-warning">
              No virtual mic installed.{' '}
              <a onClick={actions.installVirtualMic}>Install Aurora Microphone</a>
              {' · or '}
              <a onClick={() => window.electronAPI?.openExternal(BH_DOWNLOAD)}>use BlackHole</a>
            </p>
          )}
          {vm && (
            <p className="step-ok" style={{ marginTop: 10 }}>Sending to <b>{vm.name}</b></p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={actions.rescan}><RefreshCw size={14} /> Rescan devices</button>
            <button className="btn btn-ghost" onClick={() => { resetSetupComplete(); onOpenSetup?.(); }}>
              Replay setup
            </button>
            <button className="btn btn-ghost" onClick={() => actions.measureLatency()} title="Loopback click test">
              <Gauge size={14} /> Measure latency
            </button>
          </div>
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
          <Toggle label="Background noise removal" hint="AI (RNNoise) removes fans, hum, hiss and keyboard clicks" on={s.noise_reduction_enabled} onClick={() => actions.updateSettings({ noise_reduction_enabled: !s.noise_reduction_enabled })} />
          {s.noise_reduction_enabled && (
            <div style={{ marginTop: 10 }}>
              <div className="field">
                <label>Mode</label>
                <select className="select" value={s.noise_reduction_mode || 'balanced'} onChange={e => actions.updateSettings({ noise_reduction_mode: e.target.value })}>
                  {NR_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              {s.noise_reduction_mode === 'quality' && engine.latency?.sample_rate && engine.latency.sample_rate !== 48000 && (
                <p className="note" style={{ marginTop: -6 }}>Studio needs a 48 kHz mic; this one runs at {Math.round(engine.latency.sample_rate / 1000)} kHz, so Balanced is used.</p>
              )}
              <Slider p={{ label: 'Strength', min: 0, max: 1, step: 0.01 }} value={s.noise_reduction_strength ?? 0.85} format={v => `${Math.round(6 + 34 * v)} dB max`} onChange={v => actions.updateSettings({ noise_reduction_strength: v })} />
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Slider p={{ label: 'Gate threshold', min: -80, max: -10, step: 1 }} value={s.noise_gate_level} format={v => `${v} dB`} onChange={v => actions.updateSettings({ noise_gate_level: v })} />
          </div>
        </div>

        <div className="panel">
          <h3>Latency</h3>
          <p className="sub">Device-side figures from Core Audio. Measured uses a loopback click when available.</p>
          <LatencyTable lat={engine.latency} />
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => actions.measureLatency()}>
            <Gauge size={14} /> Run loopback test
          </button>
          <p className="note" style={{ marginTop: 14 }}>
            <ExternalLink size={13} /> Discord / Zoom add their own capture delay on top of these numbers.
          </p>
        </div>
      </FadeUp>
    </section>
  );
}

const NR_MODES = [
  { id: 'low_latency', label: 'Low latency · +5 ms' },
  { id: 'balanced', label: 'Balanced · +15 ms' },
  { id: 'quality', label: 'Studio · +30 ms' },
];

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
    ['Input buffer', `${lat.input_ms?.toFixed?.(1) ?? '—'} ms`],
    ['Processing block', `${lat.block_ms?.toFixed?.(1) ?? '—'} ms`],
    ['Output buffer', `${lat.output_ms?.toFixed?.(1) ?? '—'} ms`],
    ...(lat.nr_ms ? [['Noise removal', `${lat.nr_ms.toFixed(1)} ms`]] : []),
    ['Total (device side)', `${lat.total_ms?.toFixed?.(1) ?? '—'} ms`],
    ['Measured (loopback)', lat.measured_ms != null ? `${Number(lat.measured_ms).toFixed(1)} ms` : '—'],
    ['DSP time per block', `${lat.dsp_ms?.toFixed?.(2) ?? '—'} ms`],
    ['Dropouts', String(lat.xruns ?? 0)],
  ];
  return rows.map(([k, v], i) => (
    <div className="toggle-row" key={k} style={k.startsWith('Total') || k.startsWith('Measured') ? { fontWeight: 600 } : undefined}>
      <span className="l">{k}</span><span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{v}</span>
    </div>
  ));
}
