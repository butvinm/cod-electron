import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { Folders } from './folders.ts';
import { readDir } from './project-fs.ts';
import { FileIndex } from './file-index.ts';
import { EditorFiles } from './editor-files.ts';
import { createClaudeProvider } from './agents/claude.ts';
import { Chats } from './agents/chats.ts';
import { createQuitGuard } from './agents/quit-guard.ts';
import { createQuitFlow } from './quit-flow.ts';
import type { EventChannels, InvokeArgs, InvokeChannel, InvokeResult, SendChannels } from './shared/ipc.ts';

// Must run before the app is ready so no real profile is touched in tests.
if (process.env.COD_USER_DATA_DIR) {
  app.setPath('userData', process.env.COD_USER_DATA_DIR);
}

// Software rendering starts faster on machines without a GPU, such as the Xvfb CI runner.
if (process.platform === 'linux') app.disableHardwareAcceleration();

const folders = new Folders();
const editorFiles = new EditorFiles(folders);
let mainWindow: BrowserWindow | null = null;

// Typed ends of the IPC contract in src/shared/ipc.ts.
// The page is not trusted: handlers still check what they are given at run time.
function handle<K extends InvokeChannel>(channel: K, handler: (...args: InvokeArgs<K>) => InvokeResult<K> | Promise<InvokeResult<K>>): void {
  // The cast is the one place where untyped IPC arguments get their declared types.
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as InvokeArgs<K>)));
}

function sendToPage<K extends keyof EventChannels>(channel: K, payload: EventChannels[K], win: BrowserWindow | null = mainWindow): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Listens for a message from the page. Returns the function that stops listening.
function listenToPage<K extends keyof SendChannels>(channel: K, listener: (...args: SendChannels[K]) => void): () => void {
  // The cast gives the untyped IPC arguments their declared types.
  const wrapped = (_event: Electron.IpcMainEvent, ...args: unknown[]): void => listener(...(args as SendChannels[K]));
  ipcMain.on(channel, wrapped);
  return () => { ipcMain.removeListener(channel, wrapped); };
}

// Test hook: COD_TEST_PICK_FOLDERS is a JSON array of arrays of paths.
// Each add-folder action takes the next array instead of showing the system dialog.
const scriptedPicks: string[][] | null = process.env.COD_TEST_PICK_FOLDERS ? JSON.parse(process.env.COD_TEST_PICK_FOLDERS) as string[][] : null;

async function pickFolders(): Promise<string[]> {
  if (scriptedPicks) {
    if (scriptedPicks.length === 0) throw new Error('COD_TEST_PICK_FOLDERS is exhausted: the test asked for more folder dialogs than it scripted');
    return scriptedPicks.shift() as string[];
  }
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'multiSelections'] };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

// The boundary where "open this file" leaves the panel. The editor story will handle it here.
// COD_TEST_OPEN_REQUEST_LOG_PATH makes every request append one JSON line, for tests.
function dispatchOpenFile(workspaceId: string, file: string): void {
  const log = process.env.COD_TEST_OPEN_REQUEST_LOG_PATH;
  if (log) fs.appendFileSync(log, `${JSON.stringify({ path: file, workspaceId })}\n`);
}

const fileIndex = new FileIndex(id => folders.list(id), workspaceId => sendToPage('finder:rebuilt', workspaceId));

// Claude chat. The agent process lives here; the page only gets events and a narrow API.
const claude = createClaudeProvider();
const chats = new Chats({
  provider: claude,
  folders: { list: id => folders.list(id) },
  emit: (workspaceId, event) => sendToPage('chat:event', { workspaceId, event }),
});

folders.on('change', payload => {
  fileIndex.reset(payload.workspaceId);
  chats.foldersChanged(payload.workspaceId);
  sendToPage('project:roots-changed', payload);
});

handle('project:roots', workspaceId => folders.list(String(workspaceId)));

handle('project:add-folders', async workspaceId => {
  const picked = await pickFolders();
  return folders.add(String(workspaceId), picked);
});

handle('project:forget', workspaceId => {
  chats.forget(String(workspaceId));
  folders.forget(String(workspaceId));
  fileIndex.forget(String(workspaceId));
});

// File finder. The main process keeps the file list and does the matching.
handle('finder:prepare', workspaceId => { fileIndex.prepare(String(workspaceId)); });
handle('finder:query', (workspaceId, text) => {
  if (typeof text !== 'string') throw new Error('Query must be a string');
  return fileIndex.query(String(workspaceId), text.slice(0, 200));
});

handle('chat:info', workspaceId => chats.info(String(workspaceId)));
handle('chat:send', async (workspaceId, text) => {
  if (typeof text !== 'string' || !text.trim() || text.length > 200000) throw new Error('Message must be non-empty text');
  await claude.ready; // the permission server must be listening before Claude starts
  chats.send(String(workspaceId), text);
});
handle('chat:permission', (workspaceId, id, answer) => {
  if (typeof id !== 'string' || !answer || typeof answer.allow !== 'boolean') throw new Error('Bad permission answer');
  const message = typeof answer.message === 'string' ? answer.message.slice(0, 2000) : undefined;
  chats.answerPermission(String(workspaceId), id, { allow: answer.allow, message, scope: answer.scope === 'session' ? 'session' : 'once' });
});
handle('chat:interrupt', workspaceId => { chats.interrupt(String(workspaceId)); });

handle('project:read-dir', dir => {
  if (typeof dir !== 'string' || !folders.contains(dir)) throw new Error('Not inside a workspace folder');
  return readDir(dir);
});

handle('project:open-file', (workspaceId, file) => {
  if (typeof file !== 'string' || !folders.workspaceContains(String(workspaceId), file)) throw new Error('Not inside a workspace folder');
  dispatchOpenFile(String(workspaceId), file);
});

// Editor file access. Same realpath containment as project reads.
handle('editor:read', (workspaceId, file) => editorFiles.read(String(workspaceId), file));
handle('editor:write', (workspaceId, file, contents) => { editorFiles.write(String(workspaceId), file, contents); });

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#3b414d',
    title: 'Cod',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

void app.whenReady().then(createWindow);

// Quitting waits, with a cap, until every Claude process and the tools it started are gone.
const chatQuitGuard = createQuitGuard({ cleanup: () => chats.closeAll(), capMs: 5000, quit: () => { quitFlow.cleanupFinished(); app.quit(); } });

// Before that, the page asks about modified files. Cancel or a failed save stops the quit.
let askCounter = 0;

function askPageToQuit(): Promise<boolean> {
  const win = mainWindow;
  if (!win || win.isDestroyed() || win.webContents.isLoading() || win.webContents.isCrashed()) return Promise.resolve(true);
  const id = ++askCounter;
  return new Promise(resolve => {
    const finish = (answer: boolean): void => {
      stopListening();
      win.removeListener('closed', onClosed);
      resolve(answer);
    };
    const stopListening = listenToPage('quit:answer', (answerId, answer) => { if (answerId === id) finish(answer === true); });
    const onClosed = (): void => finish(true);
    win.once('closed', onClosed);
    sendToPage('quit:ask', id, win);
  });
}

const quitFlow = createQuitFlow({ askPage: askPageToQuit, chatGuard: chatQuitGuard, quit: () => app.quit() });

app.on('before-quit', event => quitFlow.beforeQuit(event));

// Closing the only window quits the app, so it asks the same way, before the window is destroyed.
// It stays prevented until the chat cleanup is done.
app.on('browser-window-created', (_event, win) => {
  win.on('close', event => quitFlow.windowClose(event));
});

app.on('window-all-closed', () => app.quit());
