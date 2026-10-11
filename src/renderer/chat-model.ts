// Pure chat transcript logic. No DOM here, so it is easy to test.
//
// A transcript is { items, busy, sessionId, ... }. Items are never changed in place:
// each change returns a new state and new objects for the items that changed.
// Item kinds: user, assistant (state: streaming, complete, interrupted), tool, interrupted, error.
import type { ChatEvent, PermissionMode } from '../shared/chat.ts';
import type { Question } from './question-model.ts';

export type ReplyState = 'streaming' | 'complete' | 'interrupted';

export type ChatItem =
  | { kind: 'user'; text: string; key: number }
  | { kind: 'assistant'; text: string; state: ReplyState; key: number }
  | { kind: 'tool'; toolId: string; name: string; input: unknown; output: string | null; isError: boolean; key: number }
  | { kind: 'questions'; questions: Question[]; answers: Record<string, string>; key: number }
  | { kind: 'interrupted'; key: number }
  | { kind: 'error'; message: string; key: number };

type Unkeyed<T> = T extends unknown ? Omit<T, 'key'> : never;

export interface PermissionRequest {
  id: string;
  tool: string;
  input: unknown;
}

export interface ChatState {
  items: ChatItem[];
  busy: boolean;
  sessionId: string | null;
  // The first waiting request, or null.
  permission: PermissionRequest | null;
  permissions: PermissionRequest[];
  // The permission mode shown in the composer.
  mode: PermissionMode;
  nextKey: number;
}

// The events from the main process, plus two that the page itself adds.
export type ChatModelEvent =
  | ChatEvent
  | { type: 'user-message'; text: string }
  | { type: 'permission-answered'; id: string }
  // The person answered a question card: it leaves the queue and stays in the transcript.
  | { type: 'questions-answered'; id: string; questions: Question[]; answers: Record<string, string> };

export type TextBlock = { type: 'text' | 'code'; text: string };

export function createChat(): ChatState {
  return { items: [], busy: false, sessionId: null, permission: null, permissions: [], mode: 'manual', nextKey: 1 };
}

// permission is always the first waiting request, or null.
function withQueue(state: ChatState, permissions: PermissionRequest[]): ChatState {
  return { ...state, permissions, permission: permissions[0] || null };
}

// The session status shown in the chat header.
export function statusOf(state: ChatState): string {
  if (state.permission) return 'Needs input';
  return state.busy ? 'Working' : 'Ready';
}

// The full text of a tool input for the permission prompt: a command as it is, anything else as JSON.
export function permissionText(input: unknown): string {
  if (input && typeof input === 'object' && 'command' in input && typeof input.command === 'string') return input.command;
  return toolInputText(input);
}

export const LOGIN_HELP = 'Claude is not logged in. Run `claude auth login` in a terminal, then send your message again.';

function push(state: ChatState, item: Unkeyed<ChatItem>, patch: Partial<ChatState> = {}): ChatState {
  return { ...state, ...patch, items: [...state.items, { ...item, key: state.nextKey } as ChatItem], nextKey: state.nextKey + 1 };
}

// Marks every streaming reply as finished (state complete or interrupted).
function settle(state: ChatState, to: 'complete' | 'interrupted'): ChatState {
  if (!state.items.some(item => item.kind === 'assistant' && item.state === 'streaming')) return state;
  return { ...state, items: state.items.map(item => (item.kind === 'assistant' && item.state === 'streaming' ? { ...item, state: to } : item)) };
}

export function reduce(state: ChatState, event: ChatModelEvent): ChatState {
  switch (event.type) {
    case 'user-message':
      return push(state, { kind: 'user', text: event.text }, { busy: true });
    case 'mode':
      return state.mode === event.mode ? state : { ...state, mode: event.mode };
    case 'session':
      return state.sessionId === event.id ? state : { ...state, sessionId: event.id };
    case 'text': {
      const last = state.items[state.items.length - 1];
      if (last && last.kind === 'assistant' && last.state === 'streaming') {
        const items = state.items.slice();
        items[items.length - 1] = { ...last, text: last.text + event.text };
        return { ...state, items };
      }
      return push(state, { kind: 'assistant', text: event.text, state: 'streaming' });
    }
    case 'text-block':
      return push(settle(state, 'complete'), { kind: 'assistant', text: event.text, state: 'complete' });
    case 'message-end':
      return settle(state, 'complete');
    case 'tool-use':
      return push(settle(state, 'complete'), { kind: 'tool', toolId: event.id, name: event.name, input: event.input, output: null, isError: false });
    case 'tool-result':
      return {
        ...state,
        items: state.items.map(item => (item.kind === 'tool' && item.toolId === event.id ? { ...item, output: event.output, isError: event.isError } : item)),
      };
    // Requests wait in order; the first one is shown.
    case 'permission-request':
      return withQueue(state, [...state.permissions, { id: event.id, tool: event.tool, input: event.input }]);
    case 'permission-clear':
    case 'permission-answered':
      return withQueue(state, state.permissions.filter(request => request.id !== event.id));
    case 'questions-answered':
      return push(withQueue(state, state.permissions.filter(request => request.id !== event.id)),
        { kind: 'questions', questions: event.questions, answers: event.answers });
    case 'turn-end':
      return { ...withQueue(settle(state, 'complete'), []), busy: false };
    case 'error': {
      const message = event.kind === 'not-logged-in' ? LOGIN_HELP : event.message;
      return push(withQueue(settle(state, 'complete'), []), { kind: 'error', message }, { busy: false });
    }
    case 'interrupted':
      return push(withQueue(settle(state, 'interrupted'), []), { kind: 'interrupted' }, { busy: false });
    default:
      return state;
  }
}

// The short target shown next to the tool name, for example the file or the command.
export function toolTarget(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const fields = input as Record<string, unknown>; // a tool input is a JSON object with any fields
  for (const name of ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description']) {
    const value = fields[name];
    if (typeof value === 'string' && value) return value.split('\n')[0];
  }
  const first = Object.values(fields).find((value): value is string => typeof value === 'string' && value !== '');
  return first ? first.split('\n')[0] : '';
}

export function toolInputText(input: unknown): string {
  return JSON.stringify(input ?? {}, null, 2);
}

// Splits reply text into paragraphs and fenced code blocks. An unclosed fence, as in a
// reply that is still streaming, counts as code up to the end.
export function splitBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const fence = /```[^\n]*\n?([\s\S]*?)(?:```|$)/g;
  let from = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > from) blocks.push({ type: 'text', text: text.slice(from, match.index) });
    blocks.push({ type: 'code', text: match[1].replace(/\n$/, '') });
    from = fence.lastIndex;
    if (match[0].length === 0) fence.lastIndex++;
  }
  if (from < text.length) blocks.push({ type: 'text', text: text.slice(from) });
  return blocks;
}

// "1 of 2" while more than one request waits.
export function queueHint(waiting: number): string {
  return waiting > 1 ? `1 of ${waiting}` : '';
}

export type FocusTarget = { kind: 'reason' } | { kind: 'choice'; index: number };

// Where the focus goes when it enters a chat with a waiting prompt.
export function promptFocusTarget({ denying, choice, count }: { denying: boolean; choice?: number; count: number }): FocusTarget {
  if (denying) return { kind: 'reason' };
  return { kind: 'choice', index: Math.max(0, Math.min(count - 1, choice || 0)) };
}
