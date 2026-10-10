// Pure workspace list state. No DOM here, so it is easy to test.
// A classic script (not an ES module) so the page is ready as early as possible.
(function (root) {
  let counter = 0;

  function makeWorkspace(n) {
    counter += 1;
    return { id: `ws-${counter}`, name: `Workspace ${n}` };
  }

  function createState() {
    counter = 0;
    const first = makeWorkspace(1);
    return { workspaces: [first], activeId: first.id, nextNumber: 2 };
  }

  function add(state) {
    const ws = makeWorkspace(state.nextNumber);
    return {
      workspaces: [...state.workspaces, ws],
      activeId: ws.id,
      nextNumber: state.nextNumber + 1,
    };
  }

  function activate(state, id) {
    if (!state.workspaces.some(w => w.id === id)) return state;
    return { ...state, activeId: id };
  }

  // delta +1 is next, -1 is previous. Wraps around.
  function step(state, delta) {
    const n = state.workspaces.length;
    const i = state.workspaces.findIndex(w => w.id === state.activeId);
    return { ...state, activeId: state.workspaces[(i + delta + n) % n].id };
  }

  // Closing the active tab selects its right neighbour, or the left one at the end.
  // Closing the last workspace leaves one fresh workspace with a new identity.
  function close(state, id) {
    const i = state.workspaces.findIndex(w => w.id === id);
    if (i < 0) return state;
    const rest = state.workspaces.filter(w => w.id !== id);
    if (rest.length === 0) {
      const fresh = makeWorkspace(state.nextNumber);
      return { workspaces: [fresh], activeId: fresh.id, nextNumber: state.nextNumber + 1 };
    }
    if (id !== state.activeId) return { ...state, workspaces: rest };
    return { ...state, workspaces: rest, activeId: rest[Math.min(i, rest.length - 1)].id };
  }

  const api = { createState, add, activate, step, close };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Workspaces = api;
})(globalThis);
