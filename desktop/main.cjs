const { app, BrowserWindow, shell, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

// Fixed port: localStorage is stored per origin (incl. port). A random port lost all data on every restart.
const FIXED_PORT = 47615;
const appRoot = path.join(__dirname, '..', 'app');
let server;
let mainWindow;
const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.webp':'image/webp', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8'
};

function startLocalServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch { res.writeHead(400); return res.end('Bad request'); }
      if (pathname === '/') pathname = '/index.html';
      const target = path.resolve(appRoot, '.' + pathname);
      if (!target.startsWith(path.resolve(appRoot) + path.sep) && target !== path.join(appRoot, 'index.html')) {
        res.writeHead(403); return res.end('Forbidden');
      }
      fs.readFile(target, (err, data) => {
        if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500); return res.end('Not found'); }
        res.writeHead(200, {
          'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store'
        });
        res.end(data);
      });
    });
    server.once('error', reject);
    server.listen(FIXED_PORT, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1050, minHeight: 700,
    backgroundColor: '#f4f7f5', show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) event.preventDefault();
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.whenReady().then(async () => {
  try {
    const port = await startLocalServer();
    await createWindow(port);
  } catch (error) {
    dialog.showErrorBox('FreshDrop POS could not start', String(error));
    app.quit();
  }
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0 && server?.listening) await createWindow(server.address().port);
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (server?.listening) server.close(); });
