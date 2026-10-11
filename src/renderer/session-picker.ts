// The Claude session picker, a modal like the Open Recent picker. It lists the sessions the Claude CLI
// stored for the workspace's folders, newest first, with the first user message as title and an age.
// Typing filters the list here. The look follows Zed's agent history picker.
import type { SessionSummary } from '../shared/chat.ts';

export interface SessionPickerOptions {
  container: HTMLElement;
  load: () => Promise<SessionSummary[]>;
  choose: (session: SessionSummary) => void;
  restoreFocus: (previous: Element | null) => void;
  now?: () => number;
}

export interface SessionPicker {
  toggle(): void;
  close(): void;
  focus(): void;
  isOpen(): boolean;
}

export const EMPTY_TEXT = 'No Claude sessions for this workspace';

// Zed's compact age: "Just now", "5m", "3h", "2d", "3w", "4mo", "2y".
export function formatAge(updated: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - updated) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return 'Just now';
  if (hours < 1) return `${minutes}m`;
  if (days < 1) return `${hours}h`;
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

// Sessions whose title contains every word of the query, case-insensitive. The order is kept.
export function filterSessions(sessions: SessionSummary[], query: string): SessionSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter(session => {
    const lower = session.title.toLowerCase();
    return words.every(word => lower.includes(word));
  });
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

export function create({ container, load, choose, restoreFocus, now = Date.now }: SessionPickerOptions): SessionPicker {
  let overlay: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let list: HTMLElement | null = null;
  let all: SessionSummary[] | null = null;
  let shown: SessionSummary[] = [];
  let selected = 0;
  let previousFocus: Element | null = null;

  function draw(): void {
    if (!list || all === null) return;
    shown = filterSessions(all, input ? input.value : '');
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    const stamp = now();
    const rows: HTMLElement[] = shown.map((session, index) => {
      const row = node('div', { class: 'finder-result session-result', role: 'option', testid: 'claude-session-option', 'aria-selected': String(index === selected), 'data-session-id': session.id },
        node('span', { class: 'session-title', testid: 'claude-session-title', text: session.title }),
        node('span', { class: 'session-age', testid: 'claude-session-age', text: formatAge(session.updated, stamp) }));
      // Keep focus in the input when a row is pressed.
      row.addEventListener('mousedown', event => event.preventDefault());
      row.addEventListener('click', () => pick(index));
      return row;
    });
    if (shown.length === 0) rows.push(node('div', { class: 'session-empty', text: all.length === 0 ? EMPTY_TEXT : 'No matching sessions' }));
    list.replaceChildren(...rows);
  }

  function select(index: number): void {
    if (shown.length === 0 || !list) return;
    selected = (index + shown.length) % shown.length;
    const rows = list.children;
    for (let i = 0; i < shown.length; i++) rows[i].setAttribute('aria-selected', String(i === selected));
    rows[selected].scrollIntoView({ block: 'nearest' });
  }

  function pick(index: number): void {
    const session = shown[index];
    if (session === undefined) return;
    close();
    choose(session);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); select(selected + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); select(selected - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); pick(selected); }
  }

  function open(): void {
    previousFocus = document.activeElement;
    const field = node('input', { class: 'finder-query', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Filter Claude sessions', placeholder: 'Search...' });
    input = field;
    list = node('div', { class: 'finder-list', role: 'listbox', 'aria-label': 'Claude sessions' });
    const mine = node('div', { class: 'finder', testid: 'claude-session-picker', role: 'dialog', 'aria-label': 'Claude sessions' }, field, list);
    overlay = mine;
    all = null;
    shown = [];
    selected = 0;
    field.addEventListener('input', () => { selected = 0; draw(); });
    mine.addEventListener('keydown', onKey);
    container.replaceChildren(mine);
    field.focus();
    load().then(sessions => {
      if (overlay !== mine) return;
      all = sessions;
      draw();
    }).catch(console.error);
  }

  function close(): void {
    if (!overlay) return;
    overlay = null;
    container.replaceChildren();
    restoreFocus(previousFocus);
    previousFocus = null;
  }

  return {
    toggle: () => (overlay ? close() : open()),
    close,
    focus: () => input?.focus({ preventScroll: true }),
    isOpen: () => overlay !== null,
  };
}
