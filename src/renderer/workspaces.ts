// Pure workspace list state. No DOM here, so it is easy to test.

export interface Workspace {
  id: string;
  name: string;
}

export interface WorkspacesState {
  workspaces: Workspace[];
  activeId: string;
  nextNumber: number;
  // Set after a confirmed quit: no new workspace may appear.
  frozen?: boolean;
}

let counter = 0;

function makeWorkspace(n: number): Workspace {
  counter += 1;
  return { id: `ws-${counter}`, name: `Workspace ${n}` };
}

export function createState(): WorkspacesState {
  counter = 0;
  const first = makeWorkspace(1);
  return { workspaces: [first], activeId: first.id, nextNumber: 2 };
}

// After a confirmed quit no new workspace may appear, because its files were never asked about.
export function freeze(state: WorkspacesState): WorkspacesState {
  return { ...state, frozen: true };
}

export function add(state: WorkspacesState): WorkspacesState {
  if (state.frozen) return state;
  const ws = makeWorkspace(state.nextNumber);
  return {
    workspaces: [...state.workspaces, ws],
    activeId: ws.id,
    nextNumber: state.nextNumber + 1,
  };
}

export function activate(state: WorkspacesState, id: string): WorkspacesState {
  if (!state.workspaces.some(w => w.id === id)) return state;
  return { ...state, activeId: id };
}

// delta +1 is next, -1 is previous. Wraps around.
export function step(state: WorkspacesState, delta: number): WorkspacesState {
  const n = state.workspaces.length;
  const i = state.workspaces.findIndex(w => w.id === state.activeId);
  return { ...state, activeId: state.workspaces[(i + delta + n) % n].id };
}

// Closing the active tab selects its right neighbour, or the left one at the end.
// Closing the last workspace leaves one fresh workspace with a new identity.
export function close(state: WorkspacesState, id: string): WorkspacesState {
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
