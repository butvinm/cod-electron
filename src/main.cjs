const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { Folders } = require('./folders.cjs');
const { readDir } = require('./project-fs.cjs');
const { FileIndex } = require('./file-index.cjs');
const { EditorFiles } = require('./editor-files.cjs');
const { createClaudeProvider } = require('./agents/claude.cjs');
const { Chats } = require('./agents/chats.cjs');
const { createQuitGuard } = require('./agents/quit-guard.cjs');

// Must run before the app is ready so no real profile is touched in tests.
if (process.env.COD_USER_DATA_DIR) {
  app.setPath('userData', process.env.COD_USER_DATA_DIR);
}

// Software rendering starts faster on machines without a GPU, such as the Xvfb CI runner.
if (process.platform === 'linux') app.disableHardwareAcceleration();

const folders = new Folders();
const editorFiles = new EditorFiles(folders);
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

// Claude chat. The agent process lives here; the page only gets events and a narrow API.
const claude = createClaudeProvider();
const chats = new Chats({
  provider: claude,
  folders: { list: id => folders.list(id) },
  emit: (workspaceId, event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chat:event', { workspaceId, event });
  },
});

folders.on('change', payload => {
  fileIndex.reset(payload.workspaceId);
  chats.foldersChanged(payload.workspaceId);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('project:roots-changed', payload);
});

ipcMain.handle('project:roots', (_event, workspaceId) => folders.list(String(workspaceId)));

ipcMain.handle('project:add-folders', async (_event, workspaceId) => {
  const picked = await pickFolders();
  return folders.add(String(workspaceId), picked);
});

ipcMain.handle('project:forget', (_event, workspaceId) => {
  chats.forget(String(workspaceId));
  folders.forget(String(workspaceId));
  fileIndex.forget(String(workspaceId));
});

// File finder. The main process keeps the file list and does the matching.
ipcMain.handle('finder:prepare', (_event, workspaceId) => { fileIndex.prepare(String(workspaceId)); });
ipcMain.handle('finder:query', (_event, workspaceId, text) => {
  if (typeof text !== 'string') throw new Error('Query must be a string');
  return fileIndex.query(String(workspaceId), text.slice(0, 200));
});

ipcMain.handle('chat:info', (_event, workspaceId) => chats.info(String(workspaceId)));
ipcMain.handle('chat:send', async (_event, workspaceId, text) => {
  if (typeof text !== 'string' || !text.trim() || text.length > 200000) throw new Error('Message must be non-empty text');
  await claude.ready; // the permission server must be listening before Claude starts
  chats.send(String(workspaceId), text);
});
ipcMain.handle('chat:permission', (_event, workspaceId, id, answer) => {
  if (typeof id !== 'string' || !answer || typeof answer.allow !== 'boolean') throw new Error('Bad permission answer');
  const message = typeof answer.message === 'string' ? answer.message.slice(0, 2000) : undefined;
  chats.answerPermission(String(workspaceId), id, { allow: answer.allow, message, scope: answer.scope === 'session' ? 'session' : 'once' });
});
ipcMain.handle('chat:interrupt', (_event, workspaceId) => { chats.interrupt(String(workspaceId)); });

ipcMain.handle('project:read-dir', (_event, dir) => {
  if (typeof dir !== 'string' || !folders.contains(dir)) throw new Error('Not inside a workspace folder');
  return readDir(dir);
});

ipcMain.handle('project:open-file', (_event, workspaceId, file) => {
  if (typeof file !== 'string' || !folders.workspaceContains(String(workspaceId), file)) throw new Error('Not inside a workspace folder');
  dispatchOpenFile(String(workspaceId), file);
});

// Editor file access. Same realpath containment as project reads.
ipcMain.handle('editor:read', (_event, workspaceId, file) => editorFiles.read(String(workspaceId), file));
ipcMain.handle('editor:write', (_event, workspaceId, file, contents) => { editorFiles.write(String(workspaceId), file, contents); });

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

// Quitting waits, with a cap, until every Claude process and the tools it started are gone.
const chatQuitGuard = createQuitGuard({ cleanup: () => chats.closeAll(), capMs: 5000, quit: () => app.quit() });

// Before that, the page asks about modified files. Cancel or a failed save stops the quit.
let askingToQuit = false;
let quitConfirmed = false;
let askCounter = 0;

function askPageToQuit() {
  const win = mainWindow;
  if (!win || win.isDestroyed() || win.webContents.isLoading() || win.webContents.isCrashed()) return Promise.resolve(true);
  const id = ++askCounter;
  return new Promise(resolve => {
    const finish = answer => {
      ipcMain.removeListener('quit:answer', onAnswer);
      win.removeListener('closed', onClosed);
      resolve(answer);
    };
    const onAnswer = (_event, answerId, answer) => { if (answerId === id) finish(answer !== false); };
    const onClosed = () => finish(true);
    ipcMain.on('quit:answer', onAnswer);
    win.once('closed', onClosed);
    win.webContents.send('quit:ask', id);
  });
}

app.on('before-quit', event => {
  if (quitConfirmed) return chatQuitGuard(event);
  event.preventDefault();
  if (askingToQuit) return;
  askingToQuit = true;
  askPageToQuit().then(ok => {
    askingToQuit = false;
    if (!ok) return;
    quitConfirmed = true;
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());
