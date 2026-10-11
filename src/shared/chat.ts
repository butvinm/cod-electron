// Chat types shared by the main process (which produces the events) and the page (which draws them).

// The events of one chat, the same for any agent provider.
// The CLI's own wire format is only known to src/agents/claude-events.ts.
export type ChatEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; text: string }                 // streamed fragment of the current reply
  | { type: 'text-block'; text: string }           // a whole reply block that was not streamed
  | { type: 'message-end' }
  | { type: 'tool-use'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; output: string; isError: boolean }
  | { type: 'turn-end' }
  | { type: 'error'; kind: ErrorKind; message: string }
  | { type: 'permission-request'; id: string; tool: string; input: unknown }
  | { type: 'permission-clear'; id: string }       // the request went away without an answer
  | { type: 'interrupted' }
  | { type: 'mode'; mode: PermissionMode };        // the chat's permission mode changed

// The permission modes of a chat, in the order Shift+Tab cycles them (Claude Code's order).
export type PermissionMode = 'manual' | 'acceptEdits' | 'plan' | 'auto';

export const PERMISSION_MODES: readonly { mode: PermissionMode; label: string }[] = [
  { mode: 'manual', label: 'Manual' },
  { mode: 'acceptEdits', label: 'Accept Edits' },
  { mode: 'plan', label: 'Plan' },
  { mode: 'auto', label: 'Auto' },
];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.some(entry => entry.mode === value);
}

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const at = PERMISSION_MODES.findIndex(entry => entry.mode === mode);
  return PERMISSION_MODES[(at + 1) % PERMISSION_MODES.length].mode;
}

export function permissionModeLabel(mode: PermissionMode): string {
  return PERMISSION_MODES.find(entry => entry.mode === mode)?.label ?? 'Manual';
}

export type ErrorKind = 'not-logged-in' | 'failed' | 'missing';

// The person's answer to a permission request. Scope 'session' remembers an allow for the same tool and input.
export interface PermissionAnswer {
  allow: boolean;
  message?: string;
  scope?: 'once' | 'session';
}

// Where the chat of a workspace runs.
export interface ChatInfo {
  cwd: string;
  home: boolean;
}
