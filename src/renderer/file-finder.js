// The file finder overlay. It lives outside the app DOM that render() rebuilds,
// so it keeps its input and focus while the workbench redraws underneath.
// Matching happens in the main process; this file only draws the top results.
(function () {
  function create({ container, workspaceId, openFile, restoreFocus }) {
    let overlay = null;
    let input = null;
    let list = null;
    let results = [];
    let selected = 0;
    let previousFocus = null;
    let sequence = 0;
    let id = null;

    function node(tag, props = {}, ...kids) {
      const n = document.createElement(tag);
      for (const [key, value] of Object.entries(props)) {
        if (key === 'testid') n.dataset.testid = value;
        else if (key === 'text') n.textContent = value;
        else n.setAttribute(key, value);
      }
      n.append(...kids);
      return n;
    }

    // The path with each matched character wrapped once. Positions are sorted.
    function pathNode(rel, positions) {
      const span = node('span', { class: 'finder-path', testid: 'file-finder-path' });
      let from = 0;
      let i = 0;
      while (i < positions.length) {
        let end = i;
        while (end + 1 < positions.length && positions[end + 1] === positions[end] + 1) end++;
        if (positions[i] > from) span.append(rel.slice(from, positions[i]));
        for (let k = i; k <= end; k++) span.append(node('span', { class: 'finder-match', testid: 'file-finder-match', text: rel[positions[k]] }));
        from = positions[end] + 1;
        i = end + 1;
      }
      if (from < rel.length) span.append(rel.slice(from));
      return span;
    }

    function drawResults() {
      const rows = results.map((item, index) => {
        const name = item.rel.slice(item.rel.lastIndexOf('/') + 1);
        const row = node('div', {
          class: 'finder-result',
          role: 'option',
          testid: 'file-finder-result',
          'aria-selected': String(index === selected),
          'data-path': item.path,
        }, node('span', { class: 'finder-name', testid: 'file-finder-name', text: name }), pathNode(item.rel, item.positions));
        // Keep focus in the input when a row is pressed.
        row.addEventListener('mousedown', event => event.preventDefault());
        row.addEventListener('click', () => choose(index));
        return row;
      });
      list.replaceChildren(...rows);
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }

    function select(index) {
      if (results.length === 0) return;
      selected = (index + results.length) % results.length;
      const rows = list.children;
      for (let i = 0; i < rows.length; i++) rows[i].setAttribute('aria-selected', String(i === selected));
      rows[selected].scrollIntoView({ block: 'nearest' });
    }

    async function runQuery() {
      const mine = ++sequence;
      let found = [];
      try { found = await window.cod.project.finderQuery(id, input.value); } catch (error) { console.error(error); }
      if (mine !== sequence || !overlay) return;
      results = found;
      selected = 0;
      drawResults();
    }

    function choose(index) {
      const item = results[index];
      if (!item) return;
      const workspace = id;
      close();
      openFile(workspace, item.path);
    }

    function onKey(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); select(selected + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); select(selected - 1); }
      else if (event.key === 'Enter') { event.preventDefault(); choose(selected); }
    }

    function open() {
      id = workspaceId();
      previousFocus = document.activeElement;
      window.cod.project.finderPrepare(id).catch(console.error);
      input = node('input', { class: 'finder-query', testid: 'file-finder-query', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search files', placeholder: 'Search files' });
      list = node('div', { class: 'finder-list', role: 'listbox', 'aria-label': 'Files' });
      overlay = node('div', { class: 'finder', testid: 'file-finder', role: 'dialog', 'aria-label': 'File finder' }, input, list);
      input.addEventListener('input', runQuery);
      overlay.addEventListener('keydown', onKey);
      results = [];
      selected = 0;
      container.replaceChildren(overlay);
      input.focus();
    }

    function close() {
      if (!overlay) return;
      sequence++;
      overlay = null;
      container.replaceChildren();
      restoreFocus(previousFocus);
      previousFocus = null;
    }

    return { toggle: () => (overlay ? close() : open()), isOpen: () => overlay !== null };
  }

  window.FileFinder = { create };
})();
