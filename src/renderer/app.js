const { createState, add, activate, step, close } = Workspaces;
const { visibleRows, navigate, createPanelState } = ProjectTree;

const root = document.getElementById('cod-window');
let state = createState();

// Project panel state lives per workspace. The folders themselves live in the main process.
const panels = {};     // workspace id -> { open, expanded, selected }
const rootsOf = {};    // workspace id -> absolute root paths, mirrored from the main process
const listings = {};   // directory path -> [{ name, path, isDirectory }]
let focusPanelNext = false;

// Editor tabs. When the last tab closes, focus goes back to the active workspace tab.
const editor = Editor.create({
  roots: id => rootsOf[id] || [],
  focusFallback: () => root.querySelector('[data-testid="workspace-tab"][aria-selected="true"]')?.focus({ preventScroll: true }),
});

// Each workspace has one chat. Its DOM is kept, so render() only moves it into the new area.
const chats = {};      // workspace id -> chat view from chat.js
const chatOf = id => (chats[id] = chats[id] || Chat.create({ workspaceId: id, chatApi: window.cod.chat }));

const panelOf = id => (panels[id] = panels[id] || createPanelState());

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'testid') node.dataset.testid = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...kids);
  return node;
}

function rowsOf(id) {
  return visibleRows(rootsOf[id] || [], panelOf(id).expanded, listings);
}

async function loadDir(dir) {
  try {
    listings[dir] = await window.cod.project.readDir(dir);
  } catch (error) {
    console.error(error);
    listings[dir] = [];
  }
}

async function toggleDir(id, dir) {
  const ps = panelOf(id);
  if (ps.expanded.has(dir)) ps.expanded.delete(dir);
  else {
    await loadDir(dir);
    ps.expanded.add(dir);
  }
  render();
}

function openFile(id, file) {
  window.cod.project.openFile(id, file).then(() => editor.open(id, file)).catch(console.error);
}

// A click selects the row, then toggles a folder or opens a file, as in Zed.
function clickRow(id, row) {
  panelOf(id).selected = row.path;
  focusPanelNext = true;
  if (row.isDirectory) return toggleDir(id, row.path);
  openFile(id, row.path);
  render();
}

function onPanelKey(event) {
  if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const id = state.activeId;
  const ps = panelOf(id);
  const result = navigate(rowsOf(id), ps.selected, event.key);
  if (!result) return;
  event.preventDefault();
  if (result.select) {
    ps.selected = result.select;
    render();
  } else if (result.expand || result.collapse) toggleDir(id, result.expand || result.collapse);
  else if (result.open) openFile(id, result.open);
}

function projectRow(id, row, selected) {
  const props = {
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
  node.addEventListener('click', () => clickRow(id, row));
  return node;
}

function projectPanel(id) {
  const ps = panelOf(id);
  const addButton = el('button', { class: 'project-add', testid: 'project-add-folder', 'aria-label': 'Add folder to workspace', title: 'Add folder', text: 'Add Folder' });
  addButton.addEventListener('click', () => window.cod.project.addFolders(id).catch(console.error));
  const tree = el('div', { class: 'project-tree', role: 'tree', 'aria-label': 'Project' });
  let wrapper = null;
  for (const row of rowsOf(id)) {
    if (row.depth === 0) {
      wrapper = el('div', { class: 'project-root', role: 'group', testid: 'project-root', 'data-path': row.path });
      tree.append(wrapper);
    }
    wrapper.append(projectRow(id, row, ps.selected));
  }
  const panel = el('div', { class: 'project-panel', testid: 'project-panel', tabindex: '0', 'aria-label': 'Project panel' }, el('div', { class: 'project-header' }, addButton), tree);
  panel.addEventListener('keydown', onPanelKey);
  return panel;
}

function render() {
  // Rebuilding the DOM drops focus and scroll, so remember them first.
  const focused = document.activeElement;
  const plusHadFocus = focused?.dataset?.testid === 'workspace-add';
  const addHadFocus = focused?.dataset?.testid === 'project-add-folder';
  const panelHadFocus = focused?.dataset?.testid === 'project-panel';
  const restoreEditor = editor.detach();
  const chatFocus = focused && chats[state.activeId]?.element.contains(focused) ? focused : null;
  const oldScroller = root.querySelector('.tabs');
  const scrollLeft = oldScroller ? oldScroller.scrollLeft : 0;
  const oldTree = root.querySelector('.project-tree');
  const treeScroll = oldTree ? oldTree.scrollTop : 0;
  const bar = el('div', { class: 'tab-bar', testid: 'workspace-tab-bar' });
  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  bar.append(tabs);
  for (const ws of state.workspaces) {
    const selected = ws.id === state.activeId;
    const tab = el('div', {
      class: 'tab',
      role: 'tab',
      testid: 'workspace-tab',
      'aria-selected': String(selected),
      'data-workspace-id': ws.id,
      tabindex: selected ? '0' : '-1',
    },
    el('span', { class: 'tab-label', testid: 'workspace-tab-label', text: ws.name }),
    el('button', { class: 'tab-close', testid: 'workspace-close', 'aria-label': `Close ${ws.name}`, tabindex: '-1', text: String.fromCharCode(0xd7) }));
    tab.addEventListener('click', () => update(activate(state, ws.id)));
    tab.querySelector('button').addEventListener('click', event => {
      event.stopPropagation();
      update(close(state, ws.id));
    });
    tabs.append(tab);
  }
  const plus = el('button', { class: 'add', testid: 'workspace-add', 'aria-label': 'New workspace', title: 'New workspace', text: '+' });
  plus.addEventListener('click', () => update(add(state)));
  bar.append(plus);

  const area = el('div', { class: 'workspace-area', testid: 'workspace-area', 'data-workspace-id': state.activeId });
  area.append(editor.element);
  editor.show(state.activeId);
  area.append(chatOf(state.activeId).element);
  const body = el('div', { class: 'workbench' });
  const panel = panelOf(state.activeId).open ? projectPanel(state.activeId) : null;
  if (panel) body.append(panel);
  body.append(area);
  root.replaceChildren(bar, body);

  const editorHadFocus = restoreEditor();
  tabs.scrollLeft = scrollLeft;
  const active = tabs.querySelector('[aria-selected="true"]');
  active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (panel) {
    panel.querySelector('.project-tree').scrollTop = treeScroll;
    panel.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  // Focus goes where it was, or to the panel when asked, otherwise to the active tab.
  // While the finder is open it keeps focus, whatever redraws underneath.
  if (finder.isOpen()) finder.focus();
  else if (panel && focusPanelNext) panel.focus({ preventScroll: true });
  else if (editorHadFocus) editor.focus();
  else if (chatFocus) chatFocus.focus({ preventScroll: true });
  else if (panel && addHadFocus) panel.querySelector('.project-add').focus({ preventScroll: true });
  else if (panel && panelHadFocus) panel.focus({ preventScroll: true });
  else (plusHadFocus ? plus : active).focus({ preventScroll: true });
  focusPanelNext = false;
}

function update(next) {
  const gone = state.workspaces.filter(w => !next.workspaces.some(n => n.id === w.id));
  // The finder searches one workspace, so switching or closing one closes it.
  const switched = next.activeId !== state.activeId;
  if (switched) finder.close();
  state = next;
  for (const ws of gone) {
    delete panels[ws.id];
    delete rootsOf[ws.id];
    editor.forget(ws.id);
    delete chats[ws.id];
    window.cod.project.forget(ws.id).catch(console.error);
  }
  render();
  // Switching to a chat with a waiting permission prompt puts the focus on the prompt.
  if (switched) chats[state.activeId]?.focusPrompt();
}

function togglePanel() {
  const ps = panelOf(state.activeId);
  ps.open = !ps.open;
  focusPanelNext = ps.open;
  render();
}

function focusPanel() {
  panelOf(state.activeId).open = true;
  focusPanelNext = true;
  render();
}

// The finder sits outside the DOM that render() rebuilds.
// If the control that had focus was replaced meanwhile, find its successor by test id, else fall back to the active tab.
const finder = FileFinder.create({
  container: document.getElementById('finder-root'),
  workspaceId: () => state.activeId,
  openFile,
  restoreFocus(previous) {
    let target = previous;
    if (!target || !target.isConnected) {
      const selector = FileFinder.focusSelector(previous);
      target = (selector && root.querySelector(selector)) || root.querySelector('[role="tab"][aria-selected="true"]');
    }
    target?.focus({ preventScroll: true });
  },
});

// The index finished a rebuild: re-run the current query so results are never stale.
window.cod.project.onFinderRebuilt(workspaceId => finder.refresh(workspaceId));

const actions = {
  save: () => editor.save(),
  'close-tab': () => editor.closeActive(),
  'file-finder': () => finder.toggle(),
  add: () => update(add(state)),
  next: () => update(step(state, 1)),
  previous: () => update(step(state, -1)),
  close: () => update(close(state, state.activeId)),
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
  rootsOf[workspaceId] = roots;
  chats[workspaceId]?.refreshInfo();
  render();
});

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
  if (editor.promptOpen() || finder.isOpen()) return;
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
window.cod.onAction(action => actions[action]());
