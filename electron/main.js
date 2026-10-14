const {
  app, BrowserWindow, ipcMain, globalShortcut,
  Tray, Menu, shell, dialog, systemPreferences, nativeImage, Notification,
} = require('electron');
const fs = require('fs');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');

const isMac = process.platform === 'darwin';
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

let pyProcess = null;
let ws = null;
let mainWindow = null;
let tray = null;
let reconnectTimer = null;

// ── Microphone permission (macOS only; Windows asks per app in Settings) ──────

async function requestMicPermission() {
  if (!isMac) return true;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return true;

  const granted = await systemPreferences.askForMediaAccess('microphone');
  if (!granted) {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Microphone access required',
      message: 'Aurora Voice needs microphone access to change your voice.',
      detail: 'Turn it on in System Settings → Privacy & Security → Microphone, then restart the app.',
      buttons: ['Open System Settings', 'Cancel'],
    });
    if (result.response === 0) {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    }
  }
  return granted;
}

// ── Python audio engine ───────────────────────────────────────────────────────

function pythonDir() {
  return isDev
    ? path.join(__dirname, '../python')
    : path.join(process.resourcesPath, 'python');
}

function startPython() {
  const exe = process.env.AURORA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const script = path.join(pythonDir(), 'ws_server.py');

  pyProcess = spawn(exe, ['-u', script], {
    cwd: pythonDir(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pyProcess.stdout.on('data', d => process.stdout.write(`[py] ${d}`));
  pyProcess.stderr.on('data', d => process.stderr.write(`[py] ${d}`));
  pyProcess.on('error', err => console.error('[py] Launch failed:', err));
  pyProcess.on('exit', code => console.log(`[py] Exited: ${code}`));

  setTimeout(connectWS, 1500);
}

// Main keeps its own socket so tray items and global hotkeys work while the
// window is hidden. The renderer talks to the engine directly.
function connectWS() {
  clearTimeout(reconnectTimer);
  if (ws?.readyState === WebSocket.OPEN) return;

  ws = new WebSocket('ws://localhost:9001');
  ws.on('open', () => console.log('[ws] main connected to engine'));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    onEngineMessage(msg);
  });
  ws.on('close', () => { reconnectTimer = setTimeout(connectWS, 1500); });
  ws.on('error', () => ws.terminate());
}

// Hotkey results matter most when the window is hidden (mid-game): say so.
function onEngineMessage(msg) {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) return;  // the window shows its own toast
  let body = null;
  if (msg.type === 'recordings' && msg.replay) {
    const item = (msg.list || []).find((r) => r.id === msg.added);
    body = item ? `Saved the last ${Math.round(item.duration)} s as “${item.name}”.` : 'Instant replay saved.';
  } else if (msg.type === 'recordings' && msg.added) {
    body = 'Recording saved.';
  } else if (msg.type === 'record_error') {
    body = msg.msg;
  }
  if (body && Notification.isSupported()) new Notification({ title: 'Aurora Voice', body, silent: true }).show();
}

function send(cmd) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    show: false,
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../assets/icon.png'),
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#cccccc', height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));

  mainWindow.webContents.on('did-fail-load', () => {
    if (isDev) setTimeout(() => mainWindow?.loadURL(DEV_URL), 1500);
  });

  // Closing hides to the menu bar / tray so the voice keeps running.
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(async () => {
  // Packaged builds take the icon from the bundle; dev runs need it set here.
  if (isMac && isDev) app.dock?.setIcon(path.join(__dirname, '../assets/icon.png'));
  const micOk = await requestMicPermission();
  if (!micOk) {
    app.quit();
    return;
  }

  startPython();
  createWindow();
  buildMenu();
  setupTray();
  registerHotkeys();
});

// ── Menu ──────────────────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: 'Aurora Voice',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { type: 'separator' },
        { label: 'Quit Aurora Voice', accelerator: 'Cmd+Q', click: () => { app.isQuitting = true; app.quit(); } },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }],
    },
    {
      label: 'Voice',
      submenu: [
        { label: 'Toggle voice on/off', accelerator: 'F1', click: () => send({ cmd: 'toggle_bypass' }) },
        { label: 'Toggle hear myself', accelerator: 'F2', click: () => send({ cmd: 'toggle_monitor' }) },
        { label: 'Mute microphone', accelerator: 'F3', click: () => send({ cmd: 'toggle_mute' }) },
      ],
    },
    {
      label: 'Recorder',
      submenu: [
        { label: 'Save instant replay', accelerator: 'F5', click: () => send({ cmd: 'replay_save' }) },
        { label: 'Start / stop recording', accelerator: 'F6', click: () => send({ cmd: 'toggle_record' }) },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { label: 'Show Aurora Voice', click: () => mainWindow?.show() }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function setupTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray-icon.png'));
  if (isMac) icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('Aurora Voice');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Aurora Voice', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Toggle voice on/off', click: () => send({ cmd: 'toggle_bypass' }) },
    { label: 'Mute microphone', click: () => send({ cmd: 'toggle_mute' }) },
    { type: 'separator' },
    { label: 'Save instant replay', click: () => send({ cmd: 'replay_save' }) },
    { label: 'Start / stop recording', click: () => send({ cmd: 'toggle_record' }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => (mainWindow?.isVisible() ? mainWindow.focus() : mainWindow?.show()));
}

// ── Global hotkeys ────────────────────────────────────────────────────────────

const BASE_HOTKEYS = {
  F1: () => send({ cmd: 'toggle_bypass' }),
  F2: () => send({ cmd: 'toggle_monitor' }),
  F3: () => send({ cmd: 'toggle_mute' }),
  F4: () => (mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show()),
  F5: () => send({ cmd: 'replay_save' }),
  F6: () => send({ cmd: 'toggle_record' }),
};
let soundHotkeys = [];

function registerHotkeys() {
  for (const [key, fn] of Object.entries(BASE_HOTKEYS)) {
    try {
      if (!globalShortcut.register(key, fn)) console.warn(`[hotkeys] ${key} is taken by another app`);
    } catch (e) {
      console.warn(`[hotkeys] ${key}:`, e.message);
    }
  }
}

// Soundboard keybinds work while Aurora is in the background, like Voicemod's.
ipcMain.handle('set-sound-hotkeys', (_, list) => {
  soundHotkeys.forEach((acc) => { try { globalShortcut.unregister(acc); } catch { /* ignore */ } });
  soundHotkeys = [];
  const failed = [];
  for (const { accelerator, id } of Array.isArray(list) ? list : []) {
    if (!accelerator || BASE_HOTKEYS[accelerator] || typeof id !== 'string') { failed.push(accelerator); continue; }
    try {
      if (globalShortcut.register(accelerator, () => send({ cmd: 'play_sound', id }))) soundHotkeys.push(accelerator);
      else failed.push(accelerator);
    } catch {
      failed.push(accelerator);
    }
  }
  return { registered: soundHotkeys, failed };
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

app.on('activate', () => mainWindow?.show());

app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  send({ cmd: 'stop' });
  setTimeout(() => pyProcess?.kill(), 400);
});

app.on('will-quit', () => pyProcess?.kill());

// Only the app's own recordings, never an arbitrary path from the page.
ipcMain.handle('reveal-recording', (_, file) => {
  if (typeof file !== 'string' || !/\/recordings\/r[0-9a-f]{10}\.wav$/.test(file) || !fs.existsSync(file)) return false;
  shell.showItemInFolder(file);
  return true;
});

ipcMain.handle('open-external', (_, url) => {
  if (/^(https:|x-apple\.systempreferences:)/.test(url)) shell.openExternal(url);
});
