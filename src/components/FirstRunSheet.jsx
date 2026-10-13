import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ExternalLink, Mic, Radio, RefreshCw, Headphones } from 'lucide-react';
import { actions } from '../lib/engine';
import { BH_DOWNLOAD, findVirtualMic, markSetupComplete, pickRealMic } from '../lib/demo';

/**
 * Blocks free scroll until mic + virtual mic are confirmed.
 * Mirrors Voicemod's first-run routing: mic in → virtual out → pick virtual in Discord.
 */
export default function FirstRunSheet({ engine, onDone }) {
  const { devices, route, connected } = engine;
  const inputs = useMemo(
    () => devices.filter(d => d.inputs > 0 && !d.is_virtual_mic),
    [devices],
  );
  const vm = findVirtualMic(devices);
  const suggestedMic = pickRealMic(devices);
  const [mic, setMic] = useState(() => route.input ?? suggestedMic?.index ?? '');
  const [ackApps, setAckApps] = useState(false);

  // Keep mic select in sync when devices first arrive.
  const micValue = mic !== '' ? mic : (suggestedMic?.index ?? '');
  const canFinish = connected && micValue !== '' && !!vm && ackApps;

  const applyRoute = (inp, out) => {
    if (inp === '' || out == null) return;
    actions.setDevices(Number(inp), Number(out));
  };

  const onMicChange = (v) => {
    setMic(v);
    if (vm) applyRoute(v, vm.index);
  };

  const finish = () => {
    if (!canFinish) return;
    applyRoute(micValue, vm.index);
    markSetupComplete();
    onDone?.();
  };

  const openBh = () => window.electronAPI?.openExternal(BH_DOWNLOAD);

  return (
    <motion.div
      className="sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="firstrun-title"
    >
      <motion.div
        className="sheet"
        initial={{ opacity: 0, y: 28, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="eyebrow">Get hearing · 3 steps</div>
        <h2 id="firstrun-title" className="h-section" style={{ fontSize: 28, marginTop: 8 }}>
          Route your voice so Discord hears it.
        </h2>
        <p className="lede" style={{ marginTop: 8, maxWidth: 'none' }}>
          Speak into your mic. Aurora transforms it and sends it to Aurora Microphone. Pick Aurora Microphone as the microphone in Discord, Zoom or your game.
        </p>

        <ol className="sheet-steps">
          <li className={connected && micValue !== '' ? 'done' : ''}>
            <span className="step-ico"><Mic size={16} /></span>
            <div className="step-body">
              <strong>1. Microphone</strong>
              <select
                className="select"
                value={micValue}
                onChange={e => onMicChange(e.target.value)}
                disabled={!connected}
              >
                <option value="" disabled>Choose a microphone</option>
                {inputs.map(d => (
                  <option key={d.index} value={d.index}>{d.name}</option>
                ))}
              </select>
            </div>
          </li>

          <li className={vm ? 'done' : ''}>
            <span className="step-ico"><Radio size={16} /></span>
            <div className="step-body">
              <strong>2. Virtual mic (Aurora Microphone)</strong>
              {vm ? (
                <p className="step-ok"><Check size={14} /> Sending changed voice to <b>{vm.name}</b></p>
              ) : (
                <p className="device-warning" style={{ margin: '8px 0 0' }}>
                  Not installed yet. Install Aurora Microphone (asks for your Mac password once), or{' '}
                  <a onClick={openBh}>use BlackHole <ExternalLink size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /></a>
                  {' '}and Rescan.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" type="button" onClick={() => { actions.rescan(); }}>
                  <RefreshCw size={14} /> Rescan devices
                </button>
                {!vm && (
                  <button className="btn btn-primary" type="button" onClick={actions.installVirtualMic}>
                    <Radio size={14} /> Install Aurora Microphone
                  </button>
                )}
              </div>
            </div>
          </li>

          <li className={ackApps ? 'done' : ''}>
            <span className="step-ico"><Headphones size={16} /></span>
            <div className="step-body">
              <strong>3. In Discord / Zoom / game</strong>
              <p className="sub" style={{ marginTop: 6 }}>
                Set the input (microphone) to <b>{vm?.name || 'Aurora Microphone'}</b>. Keep headphones as your speaker.
              </p>
              <label className="sheet-check">
                <input type="checkbox" checked={ackApps} onChange={e => setAckApps(e.target.checked)} />
                I’ve set {vm?.name || 'Aurora Microphone'} as the mic in my call app
              </label>
            </div>
          </li>
        </ol>

        {!connected && (
          <div className="banner" style={{ marginTop: 20, maxWidth: 'none' }}>
            Starting the audio engine…
          </div>
        )}

        <div className="sheet-actions">
          <button className="btn btn-primary btn-lg" type="button" disabled={!canFinish} onClick={finish}>
            Start using Aurora
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
