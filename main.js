const { app, BrowserWindow } = require('electron');
const path = require('path');
const { initializeDatabase } = require('./src/database/db');
const { registerHandlers } = require('./src/main/handlers');

let adminWindow = null;
let kioskWindow = null;

function createAdminWindow() {
  adminWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'Gimnasio MVP — Administrador',
    webPreferences: {
      preload: path.join(__dirname, 'src/main/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  adminWindow.loadFile(path.join(__dirname, 'src/renderer/admin/index.html'));
  adminWindow.once('ready-to-show', () => adminWindow.show());
  adminWindow.on('closed', () => {
    adminWindow = null;
    app.quit();
  });
}

function createKioskWindow() {
  kioskWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    title: 'Gimnasio MVP — Kiosco',
    fullscreen: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'src/main/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  kioskWindow.loadFile(path.join(__dirname, 'src/renderer/kiosk/index.html'));
  kioskWindow.once('ready-to-show', () => kioskWindow.show());
  kioskWindow.on('closed', () => { kioskWindow = null; });
}

app.whenReady().then(() => {
  initializeDatabase(app.getPath('userData'));
  registerHandlers();

  createAdminWindow();
  createKioskWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAdminWindow();
      createKioskWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
