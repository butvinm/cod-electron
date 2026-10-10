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

  const api = { createTabs, open, activate, close, displayPath, moveChoice };
  if (typeof module !== 'undefined') module.exports = api;
  else root.EditorTabs = api;
})(globalThis);
