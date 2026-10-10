const { contextBridge, ipcRenderer } = require('electron');

// Shortcuts live here, not in the page, so a key pressed while the page is still
// loading is queued instead of lost. Cmd on macOS, Ctrl elsewhere, as Zed does.
// Workspace keys do not collide with Zed 1.23.2 default-macos.json or default-linux.json.
// The dock keys are Zed's own: Cmd+B toggles the left dock, Cmd+Shift+E focuses the project panel.
const keys = {
  KeyN: { shift: true, alt: false, action: 'add' },
  KeyJ: { shift: true, alt: true, action: 'next' },
  KeyK: { shift: true, alt: true, action: 'previous' },
  KeyQ: { shift: true, alt: true, action: 'close' },
  KeyB: { shift: false, alt: false, action: 'toggle-panel' },
  KeyE: { shift: true, alt: false, action: 'focus-panel' },
  KeyP: { shift: false, alt: false, action: 'file-finder' },
  KeyS: { shift: false, alt: false, action: 'save' },
  KeyW: { shift: false, alt: false, action: 'close-tab' },
};

const mac = process.platform === 'darwin';
const queue = [];
let listener = null;

function dispatch(action) {
  if (listener) listener(action);
  else queue.push(action);
}

window.addEventListener('keydown', event => {
  const entry = keys[event.code];
  if (!entry || event.shiftKey !== entry.shift || event.altKey !== entry.alt) return;
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primary) return;
  event.preventDefault();
  dispatch(entry.action);
}, true);

contextBridge.exposeInMainWorld('cod', {
  // Registers the single action handler and replays anything queued before it existed.
  onAction(callback) {
    listener = callback;
    while (queue.length) callback(queue.shift());
  },
  // The main process asks before quitting. The callback resolves true when quitting may go on.
  onQuitRequest(callback) {
    ipcRenderer.on('quit:ask', async (_event, id) => {
      let answer = true;
      try { answer = await callback(); } catch (error) { console.error(error); }
      ipcRenderer.send('quit:answer', id, answer);
    });
  },
  // Editor file access. The main process checks every path against the workspace folders.
  editor: {
    read: (workspaceId, file) => ipcRenderer.invoke('editor:read', workspaceId, file),
    // contents is { text, eol, bom } as returned by read.
    write: (workspaceId, file, contents) => ipcRenderer.invoke('editor:write', workspaceId, file, contents),
  },
  // Narrow chat API. The Claude process lives in the main process.
  chat: {
    info: workspaceId => ipcRenderer.invoke('chat:info', workspaceId),
    send: (workspaceId, text) => ipcRenderer.invoke('chat:send', workspaceId, text),
    interrupt: workspaceId => ipcRenderer.invoke('chat:interrupt', workspaceId),
    permission: (workspaceId, id, answer) => ipcRenderer.invoke('chat:permission', workspaceId, id, answer),
    onEvent(callback) {
      ipcRenderer.on('chat:event', (_event, payload) => callback(payload.workspaceId, payload.event));
    },
  },
  // Narrow folder API. The main process owns the folder model and all file system access.
  project: {
    roots: workspaceId => ipcRenderer.invoke('project:roots', workspaceId),
    addFolders: workspaceId => ipcRenderer.invoke('project:add-folders', workspaceId),
    forget: workspaceId => ipcRenderer.invoke('project:forget', workspaceId),
    readDir: dir => ipcRenderer.invoke('project:read-dir', dir),
    openFile: (workspaceId, file) => ipcRenderer.invoke('project:open-file', workspaceId, file),
    finderPrepare: workspaceId => ipcRenderer.invoke('finder:prepare', workspaceId),
    finderQuery: (workspaceId, text) => ipcRenderer.invoke('finder:query', workspaceId, text),
    onFinderRebuilt(callback) {
      ipcRenderer.on('finder:rebuilt', (_event, workspaceId) => callback(workspaceId));
    },
    onRootsChanged(callback) {
      ipcRenderer.on('project:roots-changed', (_event, payload) => callback(payload));
    },
  },
});
