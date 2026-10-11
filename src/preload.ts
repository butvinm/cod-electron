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
// Start screen keys are Zed's. Open Recent is alt-cmd-o. New Claude Chat takes the place of the Welcome page's workspace::NewFile (cmd-n). Add Folder to Project is cmd-shift-a. Cmd-1 to cmd-5 are the Welcome page's recent entries.
// Open Folder is cmd-o on macOS and the two-stroke ctrl-k ctrl-o on Linux (workspace::Open).
const mac = process.platform === 'darwin';
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
  KeyA: { shift: true, alt: false, action: 'add-folder' },
  Digit1: { shift: false, alt: false, action: 'recent-1' },
  Digit2: { shift: false, alt: false, action: 'recent-2' },
  Digit3: { shift: false, alt: false, action: 'recent-3' },
  Digit4: { shift: false, alt: false, action: 'recent-4' },
  Digit5: { shift: false, alt: false, action: 'recent-5' },
};
// Keys that differ by the alt modifier, so they need their own table.
const altKeys: Partial<Record<string, Action>> = { KeyO: 'open-recent' };
const plainKeys: Partial<Record<string, Action>> = mac ? { KeyO: 'open-folder', KeyN: 'new-chat' } : { KeyN: 'new-chat' };
let chord = false; // Linux: ctrl-k was pressed, ctrl-o comes next
const queue: Action[] = [];
let listener: ((action: Action) => void) | null = null;

function dispatch(action: Action): void {
  if (listener) listener(action);
  else queue.push(action);
}

window.addEventListener('keydown', event => {
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (event.key === 'Control' || event.key === 'Meta' || event.key === 'Shift' || event.key === 'Alt') return;
  const wasChord = chord;
  chord = false;
  if (!primary) return;
  const bare = !event.shiftKey && !event.altKey;
  if (!mac && bare && event.code === 'KeyK') {
    chord = true;
    event.preventDefault();
    return;
  }
  let action: Action | undefined;
  if (!mac && wasChord && bare && event.code === 'KeyO') action = 'open-folder';
  else if (bare) action = plainKeys[event.code];
  else if (event.altKey && !event.shiftKey) action = altKeys[event.code];
  if (!action) {
    const entry = keys[event.code];
    if (entry && event.shiftKey === entry.shift && event.altKey === entry.alt) action = entry.action;
  }
  if (!action) return;
  event.preventDefault();
  dispatch(action);
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
    reset: workspaceId => invoke('chat:new', workspaceId),
    send: (workspaceId, text) => invoke('chat:send', workspaceId, text),
    interrupt: workspaceId => invoke('chat:interrupt', workspaceId),
    mode: workspaceId => invoke('chat:mode', workspaceId),
    setMode: (workspaceId, mode) => invoke('chat:set-mode', workspaceId, mode),
    openLink: url => invoke('chat:open-link', url),
    permission: (workspaceId, id, answer) => invoke('chat:permission', workspaceId, id, answer),
    onEvent(callback) {
      on('chat:event', payload => callback(payload.workspaceId, payload.event));
    },
  },
  project: {
    roots: workspaceId => invoke('project:roots', workspaceId),
    addFolders: workspaceId => invoke('project:add-folders', workspaceId),
    pickFolders: () => invoke('project:pick-folders'),
    addPaths: (workspaceId, paths) => invoke('project:add-paths', workspaceId, paths),
    recent: () => invoke('recent:list'),
    onRecentChanged(callback) {
      on('recent:changed', () => callback());
    },
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
