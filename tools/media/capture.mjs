// README media: screenshots + a screencast tour of the UI, captured from
// headless Chrome over the DevTools protocol, encoded with ffmpeg.
//   1. npx vite (UI on :5173)   2. engine on :9001 (python3 python/ws_server.py)
//   3. node tools/media/capture.mjs  → docs/media/*.jpg|*.gif|*.mp4
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'docs', 'media');
const frames = join(tmpdir(), `aurora-frames-${Date.now()}`);
mkdirSync(out, { recursive: true });
mkdirSync(frames, { recursive: true });

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1440, H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${join(tmpdir(), 'aurora-chrome')}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  '--enable-gpu', '--use-angle=metal', 'about:blank',
], { stdio: 'ignore' });

let ws, seq = 0;
const pending = new Map();
const handlers = [];
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const v = await (await fetch('http://127.0.0.1:9333/json/version')).json();
      ws = new WebSocket(v.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      await new Promise((r) => ws.once('open', r));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
        else handlers.forEach((h) => h(m));
      });
      return;
    } catch { await sleep(200); }
  }
  throw new Error('Chrome did not start');
}

async function main() {
  await connect();
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (m, p) => send(m, p, s);
  await page('Page.enable');
  await page('Runtime.enable');
  await page('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  const js = async (expr) => (await page('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })).result.value;
  const shot = async (name) => {
    // 1600 px wide JPEG: sharp in a README, ~200 KB.
    const { data } = await page('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: W, height: H, scale: 1600 / (W * 2) } });
    writeFileSync(join(out, name), Buffer.from(data, 'base64'));
    console.log('wrote', name);
  };
  const nav = (id) => js(`[...document.querySelectorAll('.titlebar nav button, .nav button')].find(b => b.textContent.trim() === '${id}')?.click();`);

  // First run done, a couple of favourites, then load.
  await page('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(1500);
  await js(`localStorage.setItem('aurora.setup.complete.v1','1'); localStorage.setItem('aurora.favorites.v1', JSON.stringify(['kawaii','lyra','robot']));
    localStorage.setItem('aurora.lab.saved.v1', JSON.stringify([{name:'Radio Host',chain:[{fx:'eq',params:{low:-6,mid:4,high:2}},{fx:'distortion',params:{drive:2,bits:12}}]},{name:'Cave Echo',chain:[{fx:'pitch',params:{semitones:-3,formant:0.9}},{fx:'delay',params:{delay_ms:320,feedback:0.4,wet:0.35}}]}]));`);
  await page('Page.reload');
  await sleep(6000);

  // ── Screenshots ──
  await js(`window.__send = (c) => { const s = new WebSocket('ws://localhost:9001'); s.onopen = () => { s.send(JSON.stringify(c)); setTimeout(() => s.close(), 300); }; };`);
  await shot('hero.jpg');
  await nav('Voices'); await sleep(2600); await shot('voices.jpg');
  await nav('Soundboard'); await sleep(2600);
  await js(`document.querySelector('#soundboard .pads .pad-hit')?.click();`); await sleep(500); await shot('soundboard.jpg');
  await js(`document.querySelector('#soundboard .sb-actions .btn-ghost')?.click();`);
  await nav('Voice Lab'); await sleep(2400);
  await js(`document.querySelector('#lab .saved-item button')?.click();`); await sleep(1200); await shot('voice-lab.jpg');
  await nav('Setup'); await sleep(2400);
  await js(`const t = [...document.querySelectorAll('.toggle-row')].find(r => r.textContent.includes('Background noise removal')); const b = t?.querySelector('button.switch'); if (b && !b.classList.contains('on')) b.click();`);
  await sleep(1200); await shot('setup.jpg');

  // ── Screencast tour ──
  await nav('Live'); await sleep(2500);
  let n = 0;
  handlers.push((m) => {
    if (m.method === 'Page.screencastFrame' && m.sessionId === s) {
      writeFileSync(join(frames, `f${String(n++).padStart(5, '0')}.jpg`), Buffer.from(m.params.data, 'base64'));
      page('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
    }
  });
  await page('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const t0 = Date.now();
  await sleep(1800);
  for (const id of ['genki', 'akatsume', 'robot', 'kawaii']) {  // voice changes animate the portrait
    await js(`window.__send({cmd:'set_voice', id:'${id}'});`); await sleep(1300);
  }
  await nav('Voices'); await sleep(2200);
  await js(`const i = document.querySelector('#voices .search input'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    for (const t of ['l','ly','lyr']) { d.set.call(i, t); i.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,260)); }`);
  await sleep(1200);
  await js(`const i = document.querySelector('#voices .search input'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value'); d.set.call(i, ''); i.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(600);
  for (const f of ['AI', 'Effects', 'All']) { await js(`[...document.querySelectorAll('#voices .chip')].find(c => c.textContent.startsWith('${f}'))?.click();`); await sleep(1100); }
  await js(`[...document.querySelectorAll('#voices .face-item')].find(i => i.textContent.includes('Hina'))?.querySelector('.face-hit').click();`); await sleep(1200);
  await nav('Soundboard'); await sleep(2200);
  await js(`document.querySelectorAll('#soundboard .pads .pad-hit')[1]?.click();`); await sleep(1600);
  await nav('Voice Lab'); await sleep(2200);
  await js(`[...document.querySelectorAll('#lab .saved-item button')][1]?.click();`); await sleep(1600);
  await nav('Setup'); await sleep(2600);
  await page('Page.stopScreencast');
  const secs = (Date.now() - t0) / 1000;
  console.log(`captured ${n} frames over ${secs.toFixed(1)} s`);

  // Frames arrive irregularly; resample to a steady rate for the video.
  const fps = Math.max(1, n / secs);
  const enc = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
  enc(['-framerate', fps.toFixed(3), '-i', join(frames, 'f%05d.jpg'), '-vf', 'fps=30,scale=1440:-2:flags=lanczos', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', join(out, 'tour.mp4')]);
  const gif = (name, start, dur, width) => {
    const pal = join(frames, 'pal.png');
    enc(['-ss', String(start), '-t', String(dur), '-i', join(out, 'tour.mp4'), '-vf', `fps=12,scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`, pal]);
    enc(['-ss', String(start), '-t', String(dur), '-i', join(out, 'tour.mp4'), '-i', pal, '-lavfi', `fps=12,scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, join(out, name)]);
    console.log('wrote', name);
  };
  gif('tour.gif', 0, Math.min(26, secs), 800);
  gif('voice-switch.gif', 1.5, 5.4, 720);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  rmSync(frames, { recursive: true, force: true });
});
