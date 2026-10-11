// The permission mode label under the composer. The label is a button that opens a menu of the
// modes. Shift+Tab in the composer cycles the modes (wired in chat.ts).
import { PERMISSION_MODES, permissionModeLabel, type PermissionMode } from '../shared/chat.ts';

export interface ModeSelector {
  element: HTMLElement;
  // Shows the mode. Does not call onChoose.
  show(mode: PermissionMode): void;
}

export function createModeSelector(onChoose: (mode: PermissionMode) => void): ModeSelector {
  let current: PermissionMode = 'manual';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chat-mode-button';
  button.dataset.testid = 'chat-permission-mode';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.title = 'Permission mode (Shift+Tab in the message box cycles it)';

  const menu = document.createElement('div');
  menu.className = 'chat-mode-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Permission mode');
  menu.hidden = true;
  const items = PERMISSION_MODES.map(({ mode, label }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'chat-mode-item';
    item.setAttribute('role', 'menuitemradio');
    item.tabIndex = -1;
    item.textContent = label;
    item.addEventListener('click', () => { choose(mode); });
    return { mode, item };
  });
  menu.append(...items.map(entry => entry.item));

  const element = document.createElement('div');
  element.className = 'chat-mode';
  element.append(button, menu);

  function show(mode: PermissionMode): void {
    current = mode;
    button.textContent = permissionModeLabel(mode);
    for (const entry of items) entry.item.setAttribute('aria-checked', String(entry.mode === mode));
  }

  function isOpen(): boolean {
    return !menu.hidden;
  }

  function close(refocus: boolean): void {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  }

  function open(): void {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    (items.find(entry => entry.mode === current) ?? items[0]).item.focus();
  }

  function choose(mode: PermissionMode): void {
    close(true);
    show(mode);
    onChoose(mode);
  }

  button.addEventListener('click', () => { if (isOpen()) close(false); else open(); });
  menu.addEventListener('keydown', event => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const at = items.findIndex(entry => entry.item === document.activeElement);
    let to = -1;
    if (event.key === 'ArrowDown') to = Math.min(items.length - 1, at + 1);
    else if (event.key === 'ArrowUp') to = Math.max(0, at - 1);
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = items.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    else if (event.key === 'Tab') { close(false); return; }
    else return;
    event.preventDefault();
    items[to].item.focus();
  });
  // Clicking elsewhere, or moving the focus away, closes the menu.
  element.addEventListener('focusout', event => {
    if (isOpen() && !(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) close(false);
  });

  show('manual');
  return { element, show };
}
