const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// Must run before the app is ready so no real profile is touched in tests.
if (process.env.COD_USER_DATA_DIR) {
  app.setPath('userData', process.env.COD_USER_DATA_DIR);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#3b414d',
    title: 'Cod',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
