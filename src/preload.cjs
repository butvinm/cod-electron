const { contextBridge } = require('electron');

// Shortcuts live here, not in the page, so a key pressed while the page is still
// loading is queued instead of lost. Cmd on macOS, Ctrl elsewhere, as Zed does.
// None of them collide with Zed 1.23.2 default-macos.json or default-linux.json.
const keys = {
  KeyN: { alt: false, action: 'add' },
  KeyJ: { alt: true, action: 'next' },
  KeyK: { alt: true, action: 'previous' },
  KeyQ: { alt: true, action: 'close' },
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
  if (!entry || !event.shiftKey || event.altKey !== entry.alt) return;
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
});
