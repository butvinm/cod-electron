// Editor tabs for every workspace: the tab strip, one CodeMirror view and the close prompt.
// Each workspace keeps its own tabs. Each tab keeps its own buffer state, so unsaved edits and undo survive tab and workspace switches.
// The tab list logic is in editor-tabs.ts and CodeMirror is behind editor-cm.ts.
import type { EditorState, Text } from '@codemirror/state';
import type { Eol } from '../shared/ipc.ts';
import { closeIcon } from './icons.ts';
import * as codEditor from './editor-cm.ts';
import { createTabs, open as openTab, activate as activateTab, close as closeTab, displayPath, moveChoice, errorMessage, attemptSave, createLocks, editFilter, type Tabs } from './editor-tabs.ts';

interface Choice {
  id: 'save' | 'discard' | 'cancel';
  label: string;
}

const choices: Choice[] = [
  { id: 'save', label: 'Save' },
  { id: 'discard', label: "Don't Save" },
  { id: 'cancel', label: 'Cancel' },
];
const manyChoices: Choice[] = [
  { id: 'save', label: 'Save all' },
  { id: 'discard', label: 'Discard all' },
  { id: 'cancel', label: 'Cancel' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'testid') node.dataset.testid = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...kids);
  return node;
}

const basename = (file: string): string => file.split(/[\\/]/).pop() ?? file;

interface Buffer {
  state: EditorState;
  saved: Text;
  dirty: boolean;
  eol: Eol;
  bom: boolean;
}

interface Space {
  tabs: Tabs;
  buffers: Map<string, Buffer>;
}

interface Shown {
  workspaceId: string;
  file: string;
  buffer: Buffer;
}

interface DirtyEntry {
  workspaceId: string;
  file: string;
}

export interface EditorOptions {
  // Absolute root paths of a workspace.
  roots: (workspaceId: string) => string[];
  // Called when the last tab closes.
  focusFallback: () => void;
}

export interface Editor {
  element: HTMLElement;
  // Asks about the modified files of the given workspaces, in workspace order, then tab order.
  // Resolves true when it is fine to go on: nothing was modified, the user discarded, or every file was saved.
  // On Cancel or a failed save it resolves false. A failure first calls showWorkspace(id) and
  // then activates the failing tab and shows its error, so the user sees what went wrong.
  confirmClose(workspaceIds: string[], showWorkspace: (workspaceId: string) => void): Promise<boolean>;
  notify(message: string | null): void;
  // After a confirmed quit: every editor, including ones opened later, stays read-only until exit.
  freeze(): void;
  open(workspaceId: string, file: string): Promise<void>;
  save(): Promise<void>;
  closeActive(): void;
  // Called on every redraw with the workspace being shown.
  show(workspaceId: string): void;
  forget(workspaceId: string): void;
  // The page rebuilds its DOM and moves `element`. Call detach() first; the result restores scroll and focus afterwards.
  // restore() puts the scroll position back and returns true when the editor had focus and can take it again.
  detach(): () => boolean;
  focus(): void;
  promptOpen(): boolean;
}

export function create({ roots, focusFallback }: EditorOptions): Editor {
  const strip = el('div', { class: 'editor-tabs', role: 'tablist', 'aria-label': 'Open files' });
  const surface = el('div', { class: 'editor-surface', testid: 'editor-surface' });
  // A quiet one-line message under the tabs, for failed saves and files that cannot be opened.
  const notice = el('div', { class: 'editor-notice', role: 'alert', testid: 'editor-notice' });
  const element = el('div', { class: 'editor' }, strip, notice, surface);
  surface.hidden = true;
  notice.hidden = true;
  // The editor takes room next to the chat only while it has something to show: a tab or a message.
  const layout = (): void => { element.classList.toggle('has-content', !surface.hidden || !notice.hidden); };
  const report = (message: string | null): void => {
    notice.textContent = message || '';
    notice.hidden = !message;
    layout();
  };

  const spaces = new Map<string, Space>();
  const pending = new Set<string>();      // "workspace id\0path" of reads in flight
  let current: string | null = null;      // the workspace being shown
  let shown: Shown | null = null;         // loaded in the view
  let prompt: { close: (choiceId: Choice['id']) => void } | null = null; // while the save prompt is open
  let saving = false;                     // true while Save all writes, so closes wait

  const space = (id: string): Space => {
    let found = spaces.get(id);
    if (!found) {
      found = { tabs: createTabs(), buffers: new Map() };
      spaces.set(id, found);
    }
    return found;
  };

  const locks = createLocks();
  const view = codEditor.create({
    parent: surface,
    editFilter: editFilter(() => shown !== null && locks.has(shown.workspaceId)),
    onChange(state) {
      if (!shown) return;
      shown.buffer.state = state;
      report(null);
      refreshDirty(shown.buffer);
    },
  });

  const stateOf = (buffer: Buffer): EditorState => (shown && shown.buffer === buffer ? view.getState() : buffer.state);

  function refreshDirty(buffer: Buffer): void {
    const dirty = !stateOf(buffer).doc.eq(buffer.saved);
    if (dirty === buffer.dirty) return;
    buffer.dirty = dirty;
    renderStrip();
  }

  function renderStrip(): void {
    const tabs = current === null ? createTabs() : space(current).tabs;
    const buffers = current === null ? new Map<string, Buffer>() : space(current).buffers;
    strip.replaceChildren(...tabs.paths.map(file => {
      const selected = file === tabs.active;
      const node = el('div', {
        class: 'editor-tab',
        role: 'tab',
        testid: 'editor-tab',
        'aria-selected': String(selected),
        'data-path': file,
        title: file,
        tabindex: selected ? '0' : '-1',
      });
      if (buffers.get(file)?.dirty) node.append(el('span', { class: 'editor-unsaved', testid: 'editor-unsaved-indicator', 'aria-label': 'Unsaved changes' }));
      const close = el('button', { class: 'editor-tab-close', 'aria-label': `Close ${basename(file)}`, tabindex: '-1' }, closeIcon());
      node.append(el('span', { class: 'editor-tab-label', testid: 'editor-tab-label', text: basename(file) }), close);
      node.addEventListener('click', () => { if (current !== null) select(current, file); view.focus(); });
      node.addEventListener('keydown', event => {
        if (event.target !== node || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        view.focus();
      });
      close.addEventListener('click', event => { event.stopPropagation(); if (current !== null) void requestClose(current, file); });
      return node;
    }));
    strip.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Makes the view show the active tab of the current workspace.
  function sync(): void {
    if (shown) shown.buffer.state = view.getState();
    const tabs = current === null ? null : space(current).tabs;
    const file = tabs ? tabs.active : null;
    const buffer = current !== null && file !== null ? space(current).buffers.get(file) : undefined;
    if (current === null || file === null || !buffer) {
      shown = null;
      surface.hidden = true;
    } else {
      if (!shown || shown.buffer !== buffer) {
        view.setState(buffer.state);
        shown = { workspaceId: current, file, buffer };
        report(null);
      }
      surface.hidden = false;
    }
    renderStrip();
    layout();
  }

  function select(workspaceId: string, file: string): void {
    const s = space(workspaceId);
    s.tabs = activateTab(s.tabs, file);
    if (workspaceId === current) sync();
  }

  async function open(workspaceId: string, file: string): Promise<void> {
    const s = space(workspaceId);
    if (!s.buffers.has(file)) {
      const key = `${workspaceId}\0${file}`;
      if (pending.has(key)) return;
      pending.add(key);
      try {
        const { text, eol, bom } = await window.cod.editor.read(workspaceId, file);
        const state = view.stateFor(file, text, locks.has(workspaceId));
        s.buffers.set(file, { state, saved: state.doc, dirty: false, eol, bom });
      } catch (error) {
        console.error(error);
        if (workspaceId === current) report(`Cannot open ${basename(file)}: ${errorMessage(error)}`);
        return;
      } finally {
        pending.delete(key);
      }
    }
    s.tabs = openTab(s.tabs, file);
    if (workspaceId === current) {
      sync();
      view.focus();
    }
  }

  // Resolves true when the file is on disk. On failure the buffer stays dirty, a message shows and the editor gets focus back.
  function writeBuffer(workspaceId: string, file: string, buffer: Buffer): Promise<boolean> {
    const state = stateOf(buffer);
    return attemptSave({
      name: basename(file),
      report,
      restoreFocus: () => { if (shown) view.focus(); },
      async write() {
        await window.cod.editor.write(workspaceId, file, { text: codEditor.textOf(state), eol: buffer.eol, bom: buffer.bom });
        buffer.saved = state.doc;
        refreshDirty(buffer);
      },
    });
  }

  async function save(): Promise<void> {
    if (prompt || !shown) return;
    const { workspaceId, file, buffer } = shown;
    await writeBuffer(workspaceId, file, buffer);
  }

  // The in-window prompt of Zed 1.23.2: three stacked buttons, Save highlighted first.
  function askToSave(workspaceId: string, file: string): Promise<Choice['id']> {
    const message = el('p', { class: 'editor-prompt-message' }, el('code', { text: displayPath(roots(workspaceId), file) }), ' contains unsaved edits. Do you want to save it?');
    return ask(message, choices);
  }

  // The multi-file form: the same card with a list of paths and Save all / Discard all / Cancel.
  function askToSaveAll(entries: DirtyEntry[]): Promise<Choice['id']> {
    const list = el('ul', { class: 'editor-prompt-files' }, ...entries.map(({ workspaceId, file }) =>
      el('li', { testid: 'editor-save-prompt-file', text: displayPath(roots(workspaceId), file) })));
    const message = el('div', { class: 'editor-prompt-message' }, el('p', { text: 'Do you want to save changes to the following files?' }), list);
    return ask(message, manyChoices);
  }

  function ask(message: HTMLElement, options: Choice[]): Promise<Choice['id']> {
    return new Promise(resolve => {
      const buttons = options.map(choice => el('button', { class: 'editor-prompt-button', 'data-choice': choice.id, text: choice.label }));
      const dialog = el('div', { class: 'editor-prompt', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Unsaved changes', testid: 'editor-save-prompt', tabindex: '-1' },
        message, el('div', { class: 'editor-prompt-buttons' }, ...buttons));
      const backdrop = el('div', { class: 'editor-prompt-backdrop' }, dialog);
      let index = 0;
      const paint = (): void => { buttons.forEach((button, i) => { button.dataset.highlighted = String(i === index); }); };
      const finish = (id: Choice['id']): void => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        prompt = null;
        resolve(id);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const arrows: Partial<Record<string, number>> = { ArrowUp: -1, ArrowDown: 1 };
        const move = arrows[event.key] ?? (event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0);
        if (move) {
          index = moveChoice(index, move, options.length);
          paint();
        } else if (event.key === 'Enter') finish(options[index].id);
        else if (event.key === 'Escape') finish('cancel');
        else if (event.key.length > 1 || event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
      };
      buttons.forEach((button, i) => button.addEventListener('click', () => finish(options[i].id)));
      document.addEventListener('keydown', onKey, true);
      prompt = { close: finish };
      paint();
      document.body.append(backdrop);
      dialog.focus();
    });
  }

  async function requestClose(workspaceId: string, file: string): Promise<void> {
    if (prompt || saving) return;
    const s = space(workspaceId);
    const buffer = s.buffers.get(file);
    if (!buffer) return;
    if (buffer.dirty) {
      const choice = await askToSave(workspaceId, file);
      if (choice === 'cancel') {
        if (shown) view.focus();
        return;
      }
      // A failed save keeps the tab open and dirty; writeBuffer has shown the message and refocused the editor.
      if (choice === 'save' && !(await writeBuffer(workspaceId, file, buffer))) return;
    }
    s.tabs = closeTab(s.tabs, file);
    s.buffers.delete(file);
    if (shown && shown.buffer === buffer) shown = null;
    if (workspaceId === current) {
      sync();
      if (shown) view.focus(); else focusFallback();
    }
  }

  // Makes every open buffer of these workspaces read-only (CodeMirror's own readOnly, so Undo and Redo stop too), or editable again.
  function setLocked(workspaceIds: string[], locked: boolean): void {
    if (locked) locks.lock(workspaceIds); else locks.unlock(workspaceIds);
    for (const workspaceId of workspaceIds) {
      for (const buffer of spaces.get(workspaceId)?.buffers.values() ?? []) {
        buffer.state = shown && shown.buffer === buffer ? view.lockView(locked) : view.lockState(buffer.state, locked);
      }
    }
  }

  // From the first moment until the answer is known, the editors of these workspaces are read-only.
  // A yes keeps them read-only, because the close or quit completes next. Cancel and failures unlock them.
  async function confirmClose(workspaceIds: string[], showWorkspace: (workspaceId: string) => void): Promise<boolean> {
    if (prompt || saving) return false;
    setLocked(workspaceIds, true);
    let ok = false;
    try {
      ok = await decideClose(workspaceIds, showWorkspace);
    } finally {
      if (!ok) setLocked(workspaceIds, false);
    }
    return ok;
  }

  async function decideClose(workspaceIds: string[], showWorkspace: (workspaceId: string) => void): Promise<boolean> {
    const entries: DirtyEntry[] = [];
    for (const workspaceId of workspaceIds) {
      const s = spaces.get(workspaceId);
      if (!s) continue;
      for (const file of s.tabs.paths) if (s.buffers.get(file)?.dirty) entries.push({ workspaceId, file });
    }
    if (entries.length === 0) return true;
    const before = document.activeElement;
    const choice = await askToSaveAll(entries);
    if (choice === 'discard') return true;
    if (choice === 'save') {
      saving = true;
      try { return await saveEntries(entries, showWorkspace); } finally { saving = false; }
    }
    if (before instanceof HTMLElement && before.isConnected) before.focus();
    else if (shown) view.focus();
    return false;
  }

  // True only when every listed file is on disk and still unmodified, so edits made during a write are never dropped.
  async function saveEntries(entries: DirtyEntry[], showWorkspace: (workspaceId: string) => void): Promise<boolean> {
    const reveal = (workspaceId: string, file: string, message: string | null): void => {
      space(workspaceId).tabs = activateTab(space(workspaceId).tabs, file);
      showWorkspace(workspaceId);
      sync();
      report(message);
      view.focus();
    };
    for (const { workspaceId, file } of entries) {
      const buffer = spaces.get(workspaceId)?.buffers.get(file);
      if (!buffer || !buffer.dirty) continue;
      let message: string | null = null;
      const ok = await attemptSave({
        name: basename(file),
        report: text => { message = text; report(text); },
        restoreFocus: () => {},
        async write() {
          const state = stateOf(buffer);
          await window.cod.editor.write(workspaceId, file, { text: codEditor.textOf(state), eol: buffer.eol, bom: buffer.bom });
          buffer.saved = state.doc;
          refreshDirty(buffer);
        },
      });
      if (ok) continue;
      reveal(workspaceId, file, message);
      return false;
    }
    for (const { workspaceId, file } of entries) {
      if (!spaces.get(workspaceId)?.buffers.get(file)?.dirty) continue;
      reveal(workspaceId, file, `${basename(file)} changed while saving. Close again to review it.`);
      return false;
    }
    return true;
  }

  return {
    element,
    confirmClose,
    notify: report,
    freeze() {
      locks.lockAll();
      setLocked([...spaces.keys()], true);
    },
    open,
    save,
    closeActive() {
      if (current !== null && space(current).tabs.active !== null) void requestClose(current, space(current).tabs.active as string);
    },
    show(workspaceId) {
      if (prompt && workspaceId !== current) prompt.close('cancel');
      current = workspaceId;
      sync();
    },
    forget(workspaceId) {
      if (prompt && workspaceId === current) prompt.close('cancel');
      if (shown && shown.workspaceId === workspaceId) shown = null;
      spaces.delete(workspaceId);
      locks.unlock([workspaceId]);
      if (workspaceId === current) { current = null; sync(); }
    },
    detach() {
      const focused = view.hasFocus();
      const scroller = surface.querySelector('.cm-scroller');
      const top = scroller ? scroller.scrollTop : 0;
      const left = scroller ? scroller.scrollLeft : 0;
      return () => {
        const after = surface.querySelector('.cm-scroller');
        if (after) { after.scrollTop = top; after.scrollLeft = left; }
        return focused && !surface.hidden;
      };
    },
    focus() { view.focus(); },
    promptOpen: () => prompt !== null,
  };
}
