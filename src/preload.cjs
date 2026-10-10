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
  // Narrow folder API. The main process owns the folder model and all file system access.
  project: {
    roots: workspaceId => ipcRenderer.invoke('project:roots', workspaceId),
    addFolders: workspaceId => ipcRenderer.invoke('project:add-folders', workspaceId),
    forget: workspaceId => ipcRenderer.invoke('project:forget', workspaceId),
    readDir: dir => ipcRenderer.invoke('project:read-dir', dir),
    openFile: (workspaceId, file) => ipcRenderer.invoke('project:open-file', workspaceId, file),
    onRootsChanged(callback) {
      ipcRenderer.on('project:roots-changed', (_event, payload) => callback(payload));
    },
  },
});
