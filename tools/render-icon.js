// Renders tools/icon.html to a transparent 1024px PNG using Electron.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, process.argv[2] || 'icon.html'));
  await new Promise(r => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(__dirname, '..', process.argv[3] || 'assets/icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});
