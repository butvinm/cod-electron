// Editor tabs for every workspace: the tab strip, one CodeMirror view and the close prompt.
// Each workspace keeps its own tabs. Each tab keeps its own buffer state, so unsaved edits and undo survive tab and workspace switches.
// The tab list logic is in editor-tabs.js and CodeMirror is behind the CodEditor global (editor-cm.js).
// A classic script, like the other renderer files.
const Editor = (function () {
  const { createTabs, open: openTab, activate: activateTab, close: closeTab, displayPath, moveChoice, errorMessage, attemptSave } = EditorTabs;
  const choices = [
    { id: 'save', label: 'Save' },
    { id: 'discard', label: "Don't Save" },
    { id: 'cancel', label: 'Cancel' },
  ];

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

  const basename = file => file.split(/[\\/]/).pop();

  // options: roots(workspaceId) -> absolute root paths, focusFallback() -> called when the last tab closes.
  function create({ roots, focusFallback }) {
    const strip = el('div', { class: 'editor-tabs', role: 'tablist', 'aria-label': 'Open files' });
    const surface = el('div', { class: 'editor-surface', testid: 'editor-surface' });
    // A quiet one-line message under the tabs, for failed saves and files that cannot be opened.
    const notice = el('div', { class: 'editor-notice', role: 'alert', testid: 'editor-notice' });
    const element = el('div', { class: 'editor' }, strip, notice, surface);
    surface.hidden = true;
    notice.hidden = true;
    const report = message => {
      notice.textContent = message || '';
      notice.hidden = !message;
    };

    const spaces = new Map();   // workspace id -> { tabs, buffers: Map(path -> { state, saved, dirty }) }
    const pending = new Set();  // "workspace id\0path" of reads in flight
    let current = null;         // the workspace being shown
    let shown = null;           // { workspaceId, file, buffer } loaded in the view
    let prompt = null;          // { close(choiceId) } while the save prompt is open

    const space = id => {
      if (!spaces.has(id)) spaces.set(id, { tabs: createTabs(), buffers: new Map() });
      return spaces.get(id);
    };

    const view = CodEditor.create({
      parent: surface,
      onChange(state) {
        if (!shown) return;
        shown.buffer.state = state;
        report(null);
        refreshDirty(shown.buffer);
      },
    });

    const stateOf = buffer => (shown && shown.buffer === buffer ? view.getState() : buffer.state);

    function refreshDirty(buffer) {
      const dirty = !stateOf(buffer).doc.eq(buffer.saved);
      if (dirty === buffer.dirty) return;
      buffer.dirty = dirty;
      renderStrip();
    }

    function renderStrip() {
      const tabs = current === null ? createTabs() : space(current).tabs;
      const buffers = current === null ? new Map() : space(current).buffers;
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
        const close = el('button', { class: 'editor-tab-close', 'aria-label': `Close ${basename(file)}`, tabindex: '-1', text: String.fromCharCode(0xd7) });
        node.append(el('span', { class: 'editor-tab-label', testid: 'editor-tab-label', text: basename(file) }), close);
        node.addEventListener('click', () => { select(current, file); view.focus(); });
        node.addEventListener('keydown', event => {
          if (event.target !== node || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          view.focus();
        });
        close.addEventListener('click', event => { event.stopPropagation(); requestClose(current, file); });
        return node;
      }));
      strip.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // Makes the view show the active tab of the current workspace.
    function sync() {
      if (shown) shown.buffer.state = view.getState();
      const tabs = current === null ? null : space(current).tabs;
      const file = tabs ? tabs.active : null;
      if (file === null) {
        shown = null;
        surface.hidden = true;
      } else {
        const buffer = space(current).buffers.get(file);
        if (!shown || shown.buffer !== buffer) {
          view.setState(buffer.state);
          shown = { workspaceId: current, file, buffer };
          report(null);
        }
        surface.hidden = false;
      }
      renderStrip();
    }

    function select(workspaceId, file) {
      const s = space(workspaceId);
      s.tabs = activateTab(s.tabs, file);
      if (workspaceId === current) sync();
    }

    async function open(workspaceId, file) {
      const s = space(workspaceId);
      if (!s.buffers.has(file)) {
        const key = `${workspaceId}\0${file}`;
        if (pending.has(key)) return;
        pending.add(key);
        try {
          const { text, eol, bom } = await window.cod.editor.read(workspaceId, file);
          const state = view.stateFor(file, text);
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
    function writeBuffer(workspaceId, file, buffer) {
      const state = stateOf(buffer);
      return attemptSave({
        name: basename(file),
        report,
        restoreFocus: () => { if (shown) view.focus(); },
        async write() {
          await window.cod.editor.write(workspaceId, file, { text: CodEditor.textOf(state), eol: buffer.eol, bom: buffer.bom });
          buffer.saved = state.doc;
          refreshDirty(buffer);
        },
      });
    }

    async function save() {
      if (prompt || !shown) return;
      const { workspaceId, file, buffer } = shown;
      await writeBuffer(workspaceId, file, buffer);
    }

    // The in-window prompt of Zed 1.23.2: three stacked buttons, Save highlighted first.
    function askToSave(workspaceId, file) {
      return new Promise(resolve => {
        const message = el('p', { class: 'editor-prompt-message' }, el('code', { text: displayPath(roots(workspaceId), file) }), ' contains unsaved edits. Do you want to save it?');
        const buttons = choices.map(choice => el('button', { class: 'editor-prompt-button', 'data-choice': choice.id, text: choice.label }));
        const dialog = el('div', { class: 'editor-prompt', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Unsaved changes', testid: 'editor-save-prompt', tabindex: '-1' },
          message, el('div', { class: 'editor-prompt-buttons' }, ...buttons));
        const backdrop = el('div', { class: 'editor-prompt-backdrop' }, dialog);
        let index = 0;
        const paint = () => buttons.forEach((button, i) => button.dataset.highlighted = String(i === index));
        const finish = id => {
          document.removeEventListener('keydown', onKey, true);
          backdrop.remove();
          prompt = null;
          resolve(id);
        };
        const onKey = event => {
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          const move = { ArrowUp: -1, ArrowDown: 1 }[event.key] ?? (event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0);
          if (move) {
            index = moveChoice(index, move, choices.length);
            paint();
          } else if (event.key === 'Enter') finish(choices[index].id);
          else if (event.key === 'Escape') finish('cancel');
          else if (event.key.length > 1 || event.shiftKey) return;
          event.preventDefault();
          event.stopPropagation();
        };
        buttons.forEach((button, i) => button.addEventListener('click', () => finish(choices[i].id)));
        document.addEventListener('keydown', onKey, true);
        prompt = { close: finish };
        paint();
        document.body.append(backdrop);
        dialog.focus();
      });
    }

    async function requestClose(workspaceId, file) {
      if (prompt) return;
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

    return {
      element,
      open,
      save,
      closeActive() {
        if (current !== null && space(current).tabs.active !== null) requestClose(current, space(current).tabs.active);
      },
      // Called on every redraw with the workspace being shown.
      show(workspaceId) {
        if (prompt && workspaceId !== current) prompt.close('cancel');
        current = workspaceId;
        sync();
      },
      forget(workspaceId) {
        if (prompt && workspaceId === current) prompt.close('cancel');
        if (shown && shown.workspaceId === workspaceId) shown = null;
        spaces.delete(workspaceId);
        if (workspaceId === current) { current = null; sync(); }
      },
      // The page rebuilds its DOM and moves `element`. Call detach() first; the result restores scroll and focus afterwards.
      // restore() puts the scroll position back and returns true when the editor had focus and can take it again.
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
    };
  }

  return { create };
})();
