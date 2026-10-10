const { createState, add, activate, step, close } = Workspaces;

const root = document.getElementById('cod-window');
let state = createState();

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'testid') node.dataset.testid = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function render() {
  // Rebuilding the DOM drops focus and scroll, so remember them first.
  const plusHadFocus = document.activeElement?.dataset?.testid === 'workspace-add';
  const oldScroller = root.querySelector('.tabs');
  const scrollLeft = oldScroller ? oldScroller.scrollLeft : 0;
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
    el('button', { class: 'tab-close', testid: 'workspace-close', 'aria-label': `Close ${ws.name}`, tabindex: '-1', text: '\u00d7' }));
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
  root.replaceChildren(bar, area);

  tabs.scrollLeft = scrollLeft;
  const active = tabs.querySelector('[aria-selected="true"]');
  active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // Keep focus on the plus button if it had it, otherwise on the active tab.
  (plusHadFocus ? plus : active).focus({ preventScroll: true });
}

function update(next) {
  state = next;
  render();
}

const actions = {
  add: () => add(state),
  next: () => step(state, 1),
  previous: () => step(state, -1),
  close: () => close(state, state.activeId),
};

render();
window.cod.onAction(action => update(actions[action]()));
