// The start screen of an empty workspace, laid out like Zed's Welcome page (crates/workspace/src/welcome.rs):
// centered sections of quiet buttons, each with its key binding next to it.
import { baseName } from './recent-picker.ts';

export type StartAction = 'open-folder' | 'open-recent' | 'new-chat';

// How many recent folders the screen lists, and how many have a Cmd-1 to Cmd-5 key.
export const START_RECENT = 5;

const actions: { id: StartAction; label: string; mac: string; other: string }[] = [
  { id: 'open-folder', label: 'Open Folder', mac: 'Cmd-O', other: 'Ctrl-K Ctrl-O' },
  { id: 'open-recent', label: 'Open Recent', mac: 'Alt-Cmd-O', other: 'Alt-Ctrl-O' },
  { id: 'new-chat', label: 'New Claude Chat', mac: 'Cmd-N', other: 'Ctrl-N' },
];

export function actionLabels(mac: boolean): { id: StartAction; label: string; binding: string }[] {
  return actions.map(a => ({ id: a.id, label: a.label, binding: mac ? a.mac : a.other }));
}

export function recentBinding(index: number, mac: boolean): string {
  return `${mac ? 'Cmd' : 'Ctrl'}-${index + 1}`;
}

export interface StartScreenOptions {
  mac: boolean;
  recent: string[];
  run: (action: StartAction) => void;
  openRecent: (folder: string) => void;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'testid') n.dataset.testid = value;
    else if (key === 'text') n.textContent = value;
    else n.setAttribute(key, value);
  }
  n.append(...kids);
  return n;
}

function section(title: string, items: HTMLElement[]): HTMLElement {
  const list = node('ul', { class: 'start-list', role: 'list', 'aria-label': title }, ...items.map(item => node('li', { class: 'start-item', role: 'listitem' }, item)));
  return node('div', { class: 'start-section' },
    node('div', { class: 'start-header' }, node('span', { class: 'start-title', 'aria-hidden': 'true', text: title }), node('span', { class: 'start-rule' })),
    list);
}

export function create({ mac, recent, run, openRecent }: StartScreenOptions): HTMLElement {
  const buttons = actionLabels(mac).map(({ id, label, binding }) => {
    const button = node('button', { class: 'start-button', type: 'button', 'aria-label': label },
      node('span', { class: 'start-label', text: label }),
      node('span', { class: 'start-binding', testid: 'start-action-keybinding', text: binding }));
    button.addEventListener('click', () => run(id));
    return button;
  });
  const entries = recent.slice(0, START_RECENT).map((folder, index) => {
    const button = node('button', { class: 'start-button', type: 'button', testid: 'recent-folder', 'data-path': folder, title: folder },
      node('span', { class: 'start-label', text: baseName(folder) }),
      node('span', { class: 'start-binding', text: recentBinding(index, mac) }));
    button.addEventListener('click', () => openRecent(folder));
    return button;
  });
  return node('div', { class: 'start-screen', testid: 'start-screen' },
    node('div', { class: 'start-inner' }, section('Get Started', buttons), section('Recent', entries)));
}
