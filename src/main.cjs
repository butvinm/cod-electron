const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { Folders } = require('./folders.cjs');
const { readDir } = require('./project-fs.cjs');
const { FileIndex } = require('./file-index.cjs');

// Must run before the app is ready so no real profile is touched in tests.
if (process.env.COD_USER_DATA_DIR) {
  app.setPath('userData', process.env.COD_USER_DATA_DIR);
}

// Software rendering starts faster on machines without a GPU, such as the Xvfb CI runner.
if (process.platform === 'linux') app.disableHardwareAcceleration();

const folders = new Folders();
let mainWindow = null;

// Test hook: COD_TEST_PICK_FOLDERS is a JSON array of arrays of paths.
// Each add-folder action takes the next array instead of showing the system dialog.
const scriptedPicks = process.env.COD_TEST_PICK_FOLDERS ? JSON.parse(process.env.COD_TEST_PICK_FOLDERS) : null;

async function pickFolders() {
  if (scriptedPicks) {
    if (scriptedPicks.length === 0) throw new Error('COD_TEST_PICK_FOLDERS is exhausted: the test asked for more folder dialogs than it scripted');
    return scriptedPicks.shift();
  }
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'multiSelections'] });
  return result.canceled ? [] : result.filePaths;
}

// The boundary where "open this file" leaves the panel. The editor story will handle it here.
// COD_TEST_OPEN_REQUEST_LOG_PATH makes every request append one JSON line, for tests.
function dispatchOpenFile(workspaceId, file) {
  const log = process.env.COD_TEST_OPEN_REQUEST_LOG_PATH;
  if (log) fs.appendFileSync(log, `${JSON.stringify({ path: file, workspaceId })}\n`);
}

const fileIndex = new FileIndex(id => folders.list(id), workspaceId => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('finder:rebuilt', workspaceId);
});

folders.on('change', payload => {
  fileIndex.reset(payload.workspaceId);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('project:roots-changed', payload);
});

ipcMain.handle('project:roots', (_event, workspaceId) => folders.list(String(workspaceId)));

ipcMain.handle('project:add-folders', async (_event, workspaceId) => {
  const picked = await pickFolders();
  return folders.add(String(workspaceId), picked);
});

ipcMain.handle('project:forget', (_event, workspaceId) => {
  folders.forget(String(workspaceId));
  fileIndex.forget(String(workspaceId));
});

// File finder. The main process keeps the file list and does the matching.
ipcMain.handle('finder:prepare', (_event, workspaceId) => { fileIndex.prepare(String(workspaceId)); });
ipcMain.handle('finder:query', (_event, workspaceId, text) => {
  if (typeof text !== 'string') throw new Error('Query must be a string');
  return fileIndex.query(String(workspaceId), text.slice(0, 200));
});

ipcMain.handle('project:read-dir', (_event, dir) => {
  if (typeof dir !== 'string' || !folders.contains(dir)) throw new Error('Not inside a workspace folder');
  return readDir(dir);
});

ipcMain.handle('project:open-file', (_event, workspaceId, file) => {
  if (typeof file !== 'string' || !folders.workspaceContains(String(workspaceId), file)) throw new Error('Not inside a workspace folder');
  dispatchOpenFile(String(workspaceId), file);
});

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
  mainWindow = win;
  win.on('closed', () => { mainWindow = null; });
  // File watching is out of scope: file lists refresh when the window gains focus.
  win.on('focus', () => fileIndex.markAllStale());
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
