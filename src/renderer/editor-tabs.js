// Pure editor tab list for one workspace. No DOM here, so it is easy to test.
// A classic script (not an ES module), like workspaces.js.
// state: { paths: [absolute path, in tab order], active: path or null, history: [paths, most recent last] }
(function (root) {
  function createTabs() {
    return { paths: [], active: null, history: [] };
  }

  const touch = (history, file) => [...history.filter(p => p !== file), file];

  // Opening a file that is already open only activates it.
  // A new tab goes right after the active one, as in Zed.
  function open(tabs, file) {
    if (tabs.paths.includes(file)) return activate(tabs, file);
    const at = tabs.active === null ? tabs.paths.length : tabs.paths.indexOf(tabs.active) + 1;
    const paths = [...tabs.paths.slice(0, at), file, ...tabs.paths.slice(at)];
    return { paths, active: file, history: touch(tabs.history, file) };
  }

  function activate(tabs, file) {
    if (!tabs.paths.includes(file)) return tabs;
    return { ...tabs, active: file, history: touch(tabs.history, file) };
  }

  // Closing the active tab activates the tab that was active before it (Zed's activate_on_close: history).
  function close(tabs, file) {
    if (!tabs.paths.includes(file)) return tabs;
    const paths = tabs.paths.filter(p => p !== file);
    const history = tabs.history.filter(p => p !== file);
    if (file !== tabs.active) return { paths, active: tabs.active, history };
    return { paths, active: history.length ? history[history.length - 1] : null, history };
  }

  // The path shown in the close prompt: relative to the root that holds it.
  // With more than one root the root's own name leads, as in Zed.
  function displayPath(roots, file) {
    const sep = file.includes('\\') && !file.includes('/') ? '\\' : '/';
    const best = roots
      .filter(r => file === r || file.startsWith(r.endsWith(sep) ? r : r + sep))
      .sort((a, b) => b.length - a.length)[0];
    if (!best) return file;
    const relative = file.slice(best.length).replace(/^[\\/]+/, '');
    if (roots.length < 2) return relative || file;
    const name = best.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    return `${name}${sep}${relative}`;
  }

  // Moves the prompt highlight by delta, wrapping around.
  function moveChoice(index, delta, count) {
    return (index + delta + count) % count;
  }

  // An IPC failure arrives as "Error invoking remote method 'x': Error: reason". Keep only the reason.
  function errorMessage(error) {
    const text = String((error && error.message) || error || 'Unknown error');
    return text.replace(/^Error invoking remote method '[^']*': /, '').replace(/^Error: /, '');
  }

  // Runs a save. On failure it reports a message, gives focus back to the editor and resolves false,
  // so the caller keeps the tab dirty. On success it clears any earlier message.
  async function attemptSave({ write, report, restoreFocus, name }) {
    try {
      await write();
      report(null);
      return true;
    } catch (error) {
      report(`Could not save ${name}: ${errorMessage(error)}`);
      restoreFocus();
      return false;
    }
  }

  // Runs a confirmation that guards data. Any error means "do not go on": it reports the reason and resolves false.
  async function confirmOrKeep(confirm, report) {
    try {
      return (await confirm()) === true;
    } catch (error) {
      report(`Could not check for unsaved files: ${errorMessage(error)}`);
      return false;
    }
  }

  // Workspaces whose editors are read-only because a close or quit is under way.
  function createLocks() {
    const locked = new Set();
    return {
      lock: ids => ids.forEach(id => locked.add(id)),
      unlock: ids => ids.forEach(id => locked.delete(id)),
      has: id => locked.has(id),
    };
  }

  // A CodeMirror transaction filter: while locked, transactions that change the document are dropped.
  const editFilter = isLocked => transaction => (transaction.docChanged && isLocked() ? [] : transaction);

  const api = { createTabs, open, activate, close, displayPath, moveChoice, errorMessage, attemptSave, confirmOrKeep, createLocks, editFilter };
  if (typeof module !== 'undefined') module.exports = api;
  else root.EditorTabs = api;
})(globalThis);
