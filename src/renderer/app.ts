import type { Action, DirEntry } from '../shared/ipc.ts';
import { createState, freeze, add, activate, step, close, type WorkspacesState } from './workspaces.ts';
import { visibleRows, navigate, createPanelState, type PanelState } from './project-tree.ts';
import { confirmOrKeep } from './editor-tabs.ts';
import * as Editor from './editor.ts';
import * as Chat from './chat.ts';
import * as FileFinder from './file-finder.ts';
import * as RecentPicker from './recent-picker.ts';
import * as StartScreen from './start-screen.ts';

const root = document.getElementById('cod-window') as HTMLElement;
const finderRoot = document.getElementById('finder-root') as HTMLElement;
const pickerRoot = document.getElementById('picker-root') as HTMLElement;
const mac = navigator.userAgent.includes('Macintosh');
let state: WorkspacesState = createState();

// Project panel state lives per workspace. The folders themselves live in the main process.
const panels: Record<string, PanelState | undefined> = {};
const rootsOf: Record<string, string[] | undefined> = {};   // workspace id -> absolute root paths, mirrored from the main process
const listings: Record<string, DirEntry[] | undefined> = {}; // directory path -> entries
let focusPanelNext = false;

// Editor tabs. When the last tab closes, focus goes back to the active workspace tab.
const editor = Editor.create({
  roots: id => rootsOf[id] || [],
  focusFallback: () => root.querySelector<HTMLElement>('[data-testid="workspace-tab"][aria-selected="true"]')?.focus({ preventScroll: true }),
});

// Each workspace has one chat. Its DOM is kept, so render() only moves it into the new area.
const chats: Record<string, Chat.ChatView | undefined> = {};
const chatOf = (id: string): Chat.ChatView => (chats[id] = chats[id] || Chat.create({ workspaceId: id, chatApi: window.cod.chat }));

// Workspaces whose chat is open in the main area. Without a chat, an empty main area shows the start screen.
const chatShown: Record<string, boolean | undefined> = {};
// Recently opened folders, most recent first, mirrored from the main process.
let recents: string[] = [];

const panelOf = (id: string): PanelState => (panels[id] = panels[id] || createPanelState());

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

const testidOf = (element: Element | null): string | undefined => (element instanceof HTMLElement ? element.dataset.testid : undefined);

function rowsOf(id: string) {
  return visibleRows(rootsOf[id] || [], panelOf(id).expanded, listings);
}

async function loadDir(dir: string): Promise<void> {
  try {
    listings[dir] = await window.cod.project.readDir(dir);
  } catch (error) {
    console.error(error);
    listings[dir] = [];
  }
}

async function toggleDir(id: string, dir: string): Promise<void> {
  const ps = panelOf(id);
  if (ps.expanded.has(dir)) ps.expanded.delete(dir);
  else {
    await loadDir(dir);
    ps.expanded.add(dir);
  }
  render();
}

function openFile(id: string, file: string): void {
  window.cod.project.openFile(id, file).then(() => editor.open(id, file)).catch(console.error);
}

// A click selects the row, then toggles a folder or opens a file, as in Zed.
function clickRow(id: string, row: ReturnType<typeof rowsOf>[number]): Promise<void> | undefined {
  panelOf(id).selected = row.path;
  focusPanelNext = true;
  if (row.isDirectory) return toggleDir(id, row.path);
  openFile(id, row.path);
  render();
  return undefined;
}

function onPanelKey(event: KeyboardEvent): void {
  if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const id = state.activeId;
  const ps = panelOf(id);
  const result = navigate(rowsOf(id), ps.selected, event.key);
  if (!result) return;
  event.preventDefault();
  if (result.select) {
    ps.selected = result.select;
    render();
  } else if (result.expand || result.collapse) void toggleDir(id, (result.expand || result.collapse) as string);
  else if (result.open) openFile(id, result.open);
}

function projectRow(id: string, row: ReturnType<typeof rowsOf>[number], selected: string | null): HTMLElement {
  const props: Record<string, string> = {
    class: 'project-entry',
    role: 'treeitem',
    testid: 'project-entry',
    'aria-selected': String(row.path === selected),
    'data-path': row.path,
  };
  if (row.isDirectory) props['aria-expanded'] = String(row.expanded);
  const lead = row.isDirectory
    ? el('button', {
      class: `project-entry-toggle${row.expanded ? ' open' : ''}`,
      testid: 'project-entry-toggle',
      'aria-label': `${row.expanded ? 'Collapse' : 'Expand'} ${row.name}`,
      tabindex: '-1',
    })
    : el('span', { class: 'project-entry-toggle' });
  const node = el('div', props, lead, el('span', { class: 'project-entry-label', testid: 'project-entry-label', text: row.name }));
  // Set through the CSSOM, because the CSP blocks inline style attributes.
  node.style.paddingLeft = `${8 + row.depth * 16}px`;
  node.addEventListener('click', () => { void clickRow(id, row); });
  return node;
}

function projectPanel(id: string): HTMLElement {
  const ps = panelOf(id);
  const tree = el('div', { class: 'project-tree', role: 'tree', 'aria-label': 'Project' });
  let wrapper: HTMLElement | null = null;
  for (const row of rowsOf(id)) {
    if (row.depth === 0 || !wrapper) {
      wrapper = el('div', { class: 'project-root', role: 'group', testid: 'project-root', 'data-path': row.path });
      tree.append(wrapper);
    }
    wrapper.append(projectRow(id, row, ps.selected));
  }
  const panel = el('div', { class: 'project-panel', testid: 'project-panel', tabindex: '0', 'aria-label': 'Project panel' }, tree);
  panel.addEventListener('keydown', onPanelKey);
  return panel;
}

function render(): void {
  // Rebuilding the DOM drops focus and scroll, so remember them first.
  const focused = document.activeElement;
  const plusHadFocus = testidOf(focused) === 'workspace-add';
  const panelHadFocus = testidOf(focused) === 'project-panel';
  const restoreEditor = editor.detach();
  const chatFocus = focused instanceof HTMLElement && chats[state.activeId]?.element.contains(focused) ? focused : null;
  const oldScroller = root.querySelector('.tabs');
  const scrollLeft = oldScroller ? oldScroller.scrollLeft : 0;
  const oldTree = root.querySelector('.project-tree');
  const treeScroll = oldTree ? oldTree.scrollTop : 0;
  const bar = el('div', { class: 'tab-bar', testid: 'workspace-tab-bar' });
  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  bar.append(tabs);
  for (const ws of state.workspaces) {
    const selected = ws.id === state.activeId;
    const closeButton = el('button', { class: 'tab-close', testid: 'workspace-close', 'aria-label': `Close ${ws.name}`, tabindex: '-1', text: String.fromCharCode(0xd7) });
    const tab = el('div', {
      class: 'tab',
      role: 'tab',
      testid: 'workspace-tab',
      'aria-selected': String(selected),
      'data-workspace-id': ws.id,
      tabindex: selected ? '0' : '-1',
    },
    el('span', { class: 'tab-label', testid: 'workspace-tab-label', text: ws.name }),
    closeButton);
    tab.addEventListener('click', () => update(activate(state, ws.id)));
    closeButton.addEventListener('click', event => {
      event.stopPropagation();
      void closeWorkspace(ws.id);
    });
    tabs.append(tab);
  }
  const plus = el('button', { class: 'add', testid: 'workspace-add', 'aria-label': 'New workspace', title: 'New workspace', text: '+' });
  plus.addEventListener('click', () => update(add(state)));
  bar.append(plus);

  const area = el('div', { class: 'workspace-area', testid: 'workspace-area', 'data-workspace-id': state.activeId });
  area.append(editor.element);
  editor.show(state.activeId);
  if (chatShown[state.activeId]) area.append(chatOf(state.activeId).element);
  else area.append(startScreen());
  const body = el('div', { class: 'workbench' });
  const panel = panelOf(state.activeId).open ? projectPanel(state.activeId) : null;
  if (panel) body.append(panel);
  body.append(area);
  root.replaceChildren(bar, body);

  const editorHadFocus = restoreEditor();
  tabs.scrollLeft = scrollLeft;
  const active = tabs.querySelector<HTMLElement>('[aria-selected="true"]');
  active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (panel) {
    const tree = panel.querySelector('.project-tree');
    if (tree) tree.scrollTop = treeScroll;
    panel.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  // Focus goes where it was, or to the panel when asked, otherwise to the active tab.
  // While the finder is open it keeps focus, whatever redraws underneath.
  if (finder.isOpen()) finder.focus();
  else if (picker.isOpen()) picker.focus();
  else if (panel && focusPanelNext) panel.focus({ preventScroll: true });
  else if (editorHadFocus) editor.focus();
  else if (chatFocus) chatFocus.focus({ preventScroll: true });
  else if (panel && panelHadFocus) panel.focus({ preventScroll: true });
  else (plusHadFocus ? plus : active)?.focus({ preventScroll: true });
  focusPanelNext = false;
}

function update(next: WorkspacesState): void {
  const gone = state.workspaces.filter(w => !next.workspaces.some(n => n.id === w.id));
  // The finder searches one workspace, so switching or closing one closes it.
  const switched = next.activeId !== state.activeId;
  if (switched) {
    finder.close();
    picker.close();
  }
  state = next;
  for (const ws of gone) {
    delete panels[ws.id];
    delete rootsOf[ws.id];
    editor.forget(ws.id);
    delete chats[ws.id];
    delete chatShown[ws.id];
    window.cod.project.forget(ws.id).catch(console.error);
  }
  render();
  // Switching to a chat with a waiting permission prompt puts the focus on the prompt.
  if (switched) chats[state.activeId]?.focusPrompt();
}

const showWorkspace = (id: string): void => update(activate(state, id));

const guarded = (confirm: () => Promise<boolean> | boolean): Promise<boolean> => confirmOrKeep(confirm, message => editor.notify(message));

// Modified files are asked about first. Cancel or a failed save keeps the workspace.
async function closeWorkspace(id: string): Promise<void> {
  if (await guarded(() => editor.confirmClose([id], showWorkspace))) update(close(state, id));
}

// Quitting asks about the modified files of every workspace before the main process cleans up the chats.
// After a yes the editors stay read-only and no workspace can be added until the app exits.
window.cod.onQuitRequest(async () => {
  const ok = await guarded(() => editor.confirmClose(state.workspaces.map(w => w.id), showWorkspace));
  if (ok) {
    editor.freeze();
    state = freeze(state);
  }
  return ok;
});

function togglePanel(): void {
  const ps = panelOf(state.activeId);
  ps.open = !ps.open;
  focusPanelNext = ps.open;
  render();
}

function focusPanel(): void {
  panelOf(state.activeId).open = true;
  focusPanelNext = true;
  render();
}

// The finder sits outside the DOM that render() rebuilds.
// If the control that had focus was replaced meanwhile, find its successor by test id, else fall back to the active tab.
const finder = FileFinder.create({
  container: finderRoot,
  workspaceId: () => state.activeId,
  openFile,
  restoreFocus,
});

function restoreFocus(previous: Element | null): void {
  let target = previous;
  if (!target || !target.isConnected) {
    const selector = FileFinder.focusSelector(previous);
    target = (selector && root.querySelector(selector)) || root.querySelector('[role="tab"][aria-selected="true"]');
  }
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
}

const picker = RecentPicker.create({
  container: pickerRoot,
  load: () => window.cod.project.recent(),
  choose: folder => { void window.cod.project.addPaths(state.activeId, [folder]); },
  restoreFocus,
});

function startScreen(): HTMLElement {
  return StartScreen.create({
    mac,
    recent: recents,
    run: action => { void actions[action](); },
    openRecent: folder => { void openFolders([folder]); },
  });
}

async function refreshRecents(): Promise<void> {
  try { recents = await window.cod.project.recent(); } catch (error) { console.error(error); }
  render();
}

// Zed opens a folder in a new window unless the current one is empty. A workspace tab is Cod's window.
async function openFolders(folders: string[]): Promise<void> {
  if (folders.length === 0) return;
  if ((rootsOf[state.activeId] || []).length > 0) update(add(state));
  await window.cod.project.addPaths(state.activeId, folders);
}

async function openFolder(): Promise<void> {
  await openFolders(await window.cod.project.pickFolders());
}

function newChat(): void {
  const id = state.activeId;
  chatShown[id] = true;
  render();
  chatOf(id).composer.focus();
}

// The start screen is on screen when the workspace shows no chat and the editor has nothing open.
const startVisible = (): boolean => !chatShown[state.activeId] && !editor.element.classList.contains('has-content');

// The index finished a rebuild: re-run the current query so results are never stale.
window.cod.project.onFinderRebuilt(workspaceId => finder.refresh(workspaceId));

const actions: Record<Action, () => unknown> = {
  save: () => editor.save(),
  'close-tab': () => editor.closeActive(),
  'file-finder': () => { picker.close(); finder.toggle(); },
  'open-folder': openFolder,
  'open-recent': () => { finder.close(); picker.toggle(); },
  'new-chat': newChat,
  'add-folder': () => window.cod.project.addFolders(state.activeId).catch(console.error),
  'recent-1': () => startVisible() && openFolders(recents.slice(0, 1)),
  'recent-2': () => startVisible() && openFolders(recents.slice(1, 2)),
  'recent-3': () => startVisible() && openFolders(recents.slice(2, 3)),
  'recent-4': () => startVisible() && openFolders(recents.slice(3, 4)),
  'recent-5': () => startVisible() && openFolders(recents.slice(4, 5)),
  add: () => update(add(state)),
  next: () => update(step(state, 1)),
  previous: () => update(step(state, -1)),
  close: () => closeWorkspace(state.activeId),
  'toggle-panel': togglePanel,
  'focus-panel': focusPanel,
};

// The main process owns the folders. When they change it tells us, and new roots start expanded.
window.cod.project.onRootsChanged(async ({ workspaceId, roots }) => {
  const known = rootsOf[workspaceId] || [];
  const fresh = roots.filter(r => !known.includes(r));
  await Promise.all(fresh.map(loadDir));
  const ps = panelOf(workspaceId);
  for (const r of fresh) ps.expanded.add(r);
  // The first folder of a workspace opens the project panel.
  if (known.length === 0 && roots.length > 0) ps.open = true;
  rootsOf[workspaceId] = roots;
  chats[workspaceId]?.refreshInfo();
  await refreshRecents();
});

void refreshRecents();

// Esc interrupts the running reply of the active workspace, wherever focus is in it.
// Order: an open permission prompt first (Esc denies), then the save prompt and the file
// finder (Esc only closes them), then the chat interrupt.
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const chat = chats[state.activeId];
  if (chat?.hasPermission()) {
    event.preventDefault();
    event.stopPropagation();
    chat.interrupt();
    return;
  }
  if (editor.promptOpen() || finder.isOpen() || picker.isOpen()) return;
  if (chat?.interrupt()) event.preventDefault();
}, true);

// Chat events can arrive for any workspace, not only the visible one.
window.cod.chat.onEvent((workspaceId, event) => chats[workspaceId]?.apply(event));

// File watching is out of scope. Instead, listings refresh when the window gains focus.
window.addEventListener('focus', async () => {
  const id = state.activeId;
  const dirs = [...panelOf(id).expanded];
  const before = JSON.stringify(dirs.map(d => listings[d]));
  await Promise.all(dirs.map(loadDir));
  if (id === state.activeId && JSON.stringify(dirs.map(d => listings[d])) !== before) render();
});

render();
window.cod.onAction(action => { void actions[action](); });
