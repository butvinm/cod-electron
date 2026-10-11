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
  | { type: 'interrupted' };

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
