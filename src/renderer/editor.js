// Editor tabs for every workspace: the tab strip, one CodeMirror view and the close prompt.
// Each workspace keeps its own tabs. Each tab keeps its own buffer state, so unsaved edits and undo survive tab and workspace switches.
// The tab list logic is in editor-tabs.js and CodeMirror is behind the CodEditor global (editor-cm.js).
// A classic script, like the other renderer files.
const Editor = (function () {
  const { createTabs, open: openTab, activate: activateTab, close: closeTab, displayPath, moveChoice, errorMessage, attemptSave, createLocks, editFilter } = EditorTabs;
  const choices = [
    { id: 'save', label: 'Save' },
    { id: 'discard', label: "Don't Save" },
    { id: 'cancel', label: 'Cancel' },
  ];
  const manyChoices = [
    { id: 'save', label: 'Save all' },
    { id: 'discard', label: 'Discard all' },
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
    // The editor takes room next to the chat only while it has something to show: a tab or a message.
    const layout = () => element.classList.toggle('has-content', !surface.hidden || !notice.hidden);
    const report = message => {
      notice.textContent = message || '';
      notice.hidden = !message;
      layout();
    };

    const spaces = new Map();   // workspace id -> { tabs, buffers: Map(path -> { state, saved, dirty }) }
    const pending = new Set();  // "workspace id\0path" of reads in flight
    let current = null;         // the workspace being shown
    let shown = null;           // { workspaceId, file, buffer } loaded in the view
    let prompt = null;          // { close(choiceId) } while the save prompt is open
    let saving = false;         // true while Save all writes, so closes wait

    const space = id => {
      if (!spaces.has(id)) spaces.set(id, { tabs: createTabs(), buffers: new Map() });
      return spaces.get(id);
    };

    const locks = createLocks();
    const view = CodEditor.create({
      parent: surface,
      editFilter: editFilter(() => shown !== null && locks.has(shown.workspaceId)),
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
      layout();
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
      const message = el('p', { class: 'editor-prompt-message' }, el('code', { text: displayPath(roots(workspaceId), file) }), ' contains unsaved edits. Do you want to save it?');
      return ask(message, choices);
    }

    // The multi-file form: the same card with a list of paths and Save all / Discard all / Cancel.
    function askToSaveAll(entries) {
      const list = el('ul', { class: 'editor-prompt-files' }, ...entries.map(({ workspaceId, file }) =>
        el('li', { testid: 'editor-save-prompt-file', text: displayPath(roots(workspaceId), file) })));
      const message = el('div', { class: 'editor-prompt-message' }, el('p', { text: 'Do you want to save changes to the following files?' }), list);
      return ask(message, manyChoices);
    }

    function ask(message, choices) {
      return new Promise(resolve => {
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

    // Asks about the modified files of the given workspaces, in workspace order, then tab order.
    // Resolves true when it is fine to go on: nothing was modified, the user discarded, or every file was saved.
    // On Cancel or a failed save it resolves false. A failure first calls showWorkspace(id) and
    // then activates the failing tab and shows its error, so the user sees what went wrong.
    // Makes every open buffer of these workspaces read-only (CodeMirror's own readOnly, so Undo and Redo stop too), or editable again.
    function setLocked(workspaceIds, locked) {
      if (locked) locks.lock(workspaceIds); else locks.unlock(workspaceIds);
      for (const workspaceId of workspaceIds) {
        for (const buffer of spaces.get(workspaceId)?.buffers.values() ?? []) {
          buffer.state = shown && shown.buffer === buffer ? view.lockView(locked) : view.lockState(buffer.state, locked);
        }
      }
    }

    // From the first moment until the answer is known, the editors of these workspaces are read-only.
    // A yes keeps them read-only, because the close or quit completes next. Cancel and failures unlock them.
    async function confirmClose(workspaceIds, showWorkspace) {
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

    async function decideClose(workspaceIds, showWorkspace) {
      const entries = [];
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
      if (before && before.isConnected) before.focus();
      else if (shown) view.focus();
      return false;
    }

    // True only when every listed file is on disk and still unmodified, so edits made during a write are never dropped.
    async function saveEntries(entries, showWorkspace) {
      const reveal = (workspaceId, file, message) => {
        space(workspaceId).tabs = activateTab(space(workspaceId).tabs, file);
        showWorkspace(workspaceId);
        sync();
        report(message);
        view.focus();
      };
      {
        for (const { workspaceId, file } of entries) {
          const buffer = spaces.get(workspaceId)?.buffers.get(file);
          if (!buffer || !buffer.dirty) continue;
          let message = null;
          const ok = await attemptSave({
            name: basename(file),
            report: text => { message = text; report(text); },
            restoreFocus: () => {},
            async write() {
              const state = stateOf(buffer);
              await window.cod.editor.write(workspaceId, file, { text: CodEditor.textOf(state), eol: buffer.eol, bom: buffer.bom });
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
    }

    return {
      element,
      confirmClose,
      notify: report,
      // After a confirmed quit: every editor, including ones opened later, stays read-only until exit.
      freeze() {
        locks.lockAll();
        setLocked([...spaces.keys()], true);
      },
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
        locks.unlock([workspaceId]);
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
      promptOpen: () => prompt !== null,
    };
  }

  return { create };
})();
