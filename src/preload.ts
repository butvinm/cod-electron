import { contextBridge, ipcRenderer } from 'electron';
import type { Action, CodApi, EventChannels, InvokeArgs, InvokeChannel, InvokeResult, SendChannels } from './shared/ipc.ts';

// Typed ends of the IPC contract in src/shared/ipc.ts.
function invoke<K extends InvokeChannel>(channel: K, ...args: InvokeArgs<K>): Promise<InvokeResult<K>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<K>>;
}

function on<K extends keyof EventChannels>(channel: K, callback: (payload: EventChannels[K]) => void): void {
  ipcRenderer.on(channel, (_event, payload: EventChannels[K]) => callback(payload));
}

function send<K extends keyof SendChannels>(channel: K, ...args: SendChannels[K]): void {
  ipcRenderer.send(channel, ...args);
}

// Shortcuts live here, not in the page, so a key pressed while the page is still
// loading is queued instead of lost. Cmd on macOS, Ctrl elsewhere, as Zed does.
// Workspace keys do not collide with Zed 1.23.2 default-macos.json or default-linux.json.
// The dock keys are Zed's own: Cmd+B toggles the left dock, Cmd+Shift+E focuses the project panel.
const keys: Partial<Record<string, { shift: boolean; alt: boolean; action: Action }>> = {
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
const queue: Action[] = [];
let listener: ((action: Action) => void) | null = null;

function dispatch(action: Action): void {
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

const cod: CodApi = {
  onAction(callback) {
    listener = callback;
    let next: Action | undefined;
    while ((next = queue.shift()) !== undefined) callback(next);
  },
  onQuitRequest(callback) {
    on('quit:ask', async id => {
      // Any failure keeps the app open: only an explicit true lets the quit go on.
      let answer = false;
      try { answer = (await callback()) === true; } catch (error) { console.error(error); }
      send('quit:answer', id, answer);
    });
  },
  editor: {
    read: (workspaceId, file) => invoke('editor:read', workspaceId, file),
    write: (workspaceId, file, contents) => invoke('editor:write', workspaceId, file, contents),
  },
  chat: {
    info: workspaceId => invoke('chat:info', workspaceId),
    send: (workspaceId, text) => invoke('chat:send', workspaceId, text),
    interrupt: workspaceId => invoke('chat:interrupt', workspaceId),
    permission: (workspaceId, id, answer) => invoke('chat:permission', workspaceId, id, answer),
    onEvent(callback) {
      on('chat:event', payload => callback(payload.workspaceId, payload.event));
    },
  },
  project: {
    roots: workspaceId => invoke('project:roots', workspaceId),
    addFolders: workspaceId => invoke('project:add-folders', workspaceId),
    forget: workspaceId => invoke('project:forget', workspaceId),
    readDir: dir => invoke('project:read-dir', dir),
    openFile: (workspaceId, file) => invoke('project:open-file', workspaceId, file),
    finderPrepare: workspaceId => invoke('finder:prepare', workspaceId),
    finderQuery: (workspaceId, text) => invoke('finder:query', workspaceId, text),
    onFinderRebuilt(callback) {
      on('finder:rebuilt', callback);
    },
    onRootsChanged(callback) {
      on('project:roots-changed', callback);
    },
  },
};

contextBridge.exposeInMainWorld('cod', cod);
