// The Open Recent picker, a modal like the file finder. It lives outside the app DOM that render() rebuilds.
// The list comes from the main process when the picker opens; typing filters it here.

export interface RecentPickerOptions {
  container: HTMLElement;
  load: () => Promise<string[]>;
  choose: (folder: string) => void;
  restoreFocus: (previous: Element | null) => void;
}

export interface RecentPicker {
  toggle(): void;
  close(): void;
  focus(): void;
  isOpen(): boolean;
}

export function baseName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).pop() || folder;
}

// Folders whose path contains every word of the query, case-insensitive. The order of the list is kept.
export function filterRecent(folders: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return folders.filter(folder => {
    const lower = folder.toLowerCase();
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

export function create({ container, load, choose, restoreFocus }: RecentPickerOptions): RecentPicker {
  let overlay: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let list: HTMLElement | null = null;
  let all: string[] = [];
  let shown: string[] = [];
  let selected = 0;
  let previousFocus: Element | null = null;

  function draw(): void {
    if (!list) return;
    shown = filterRecent(all, input ? input.value : '');
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((folder, index) => {
      const row = node('div', { class: 'finder-result', role: 'option', testid: 'recent-picker-option', 'aria-selected': String(index === selected), 'data-path': folder },
        node('span', { class: 'finder-name', text: baseName(folder) }),
        node('span', { class: 'finder-path', text: folder }));
      // Keep focus in the input when a row is pressed.
      row.addEventListener('mousedown', event => event.preventDefault());
      row.addEventListener('click', () => pick(index));
      return row;
    }));
  }

  function select(index: number): void {
    if (shown.length === 0 || !list) return;
    selected = (index + shown.length) % shown.length;
    const rows = list.children;
    for (let i = 0; i < rows.length; i++) rows[i].setAttribute('aria-selected', String(i === selected));
    rows[selected].scrollIntoView({ block: 'nearest' });
  }

  function pick(index: number): void {
    const folder = shown[index];
    if (folder === undefined) return;
    close();
    choose(folder);
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
    const field = node('input', { class: 'finder-query', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search recent folders', placeholder: 'Search recent folders' });
    input = field;
    list = node('div', { class: 'finder-list', role: 'listbox', 'aria-label': 'Recent folders' });
    const mine = node('div', { class: 'finder', testid: 'recent-picker', role: 'dialog', 'aria-label': 'Open Recent' }, field, list);
    overlay = mine;
    all = [];
    shown = [];
    selected = 0;
    field.addEventListener('input', () => { selected = 0; draw(); });
    mine.addEventListener('keydown', onKey);
    container.replaceChildren(mine);
    field.focus();
    load().then(folders => {
      if (overlay !== mine) return;
      all = folders;
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
