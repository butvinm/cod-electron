// Turns the stream-json lines of the Claude CLI into the small event set the chat uses (see src/shared/chat.ts).
// This is the only place that knows the CLI's wire format. A second provider would
// produce the same events.
//   error kind is 'not-logged-in' or 'failed' here; the provider adds 'missing'.
import type { ChatEvent } from '../shared/chat.ts';

export const LOGIN_PATTERN = /not logged in|auth login|\/login|authentication|invalid api key|unauthorized|credentials/i;

// The parts of the CLI's JSON lines that are read. Everything is optional because the lines come from outside.
interface RawBlock {
  type?: string;
  text?: unknown;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: unknown;
}

interface RawStreamEvent {
  type?: string;
  message?: { id?: string };
  delta?: { type?: string; text?: unknown };
}

interface RawLine {
  type?: string;
  subtype?: string;
  session_id?: unknown;
  parent_tool_use_id?: unknown;
  event?: RawStreamEvent;
  message?: { id?: string; content?: RawBlock[] };
  is_error?: unknown;
  result?: unknown;
  errors?: unknown;
}

export function outputText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((block: { text?: unknown } | null) => (block && typeof block.text === 'string' ? block.text : '')).join('');
  }
  return content == null ? '' : JSON.stringify(content);
}

export interface Parser {
  // Feeds a chunk of stdout and returns the events for every complete line in it.
  push(chunk: string): ChatEvent[];
  // Handles a last line that had no newline.
  end(): ChatEvent[];
}

export function createParser(): Parser {
  let buffer = '';
  // Message IDs whose text already arrived as deltas, so the final copy is not shown twice.
  const streamed = new Set<string>();
  let currentMessage: string | null = null;

  function convert(raw: RawLine | null): ChatEvent[] {
    if (!raw || typeof raw !== 'object') return [];
    // Sub-agent traffic is not part of the main conversation.
    if (raw.parent_tool_use_id) return [];
    if (raw.type === 'system' && raw.subtype === 'init' && typeof raw.session_id === 'string') {
      return [{ type: 'session', id: raw.session_id }];
    }
    if (raw.type === 'stream_event' && raw.event) {
      const event = raw.event;
      if (event.type === 'message_start') {
        currentMessage = event.message?.id ?? null;
        return [];
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
        if (currentMessage) streamed.add(currentMessage);
        return [{ type: 'text', text: event.delta.text }];
      }
      if (event.type === 'message_stop') return [{ type: 'message-end' }];
      return [];
    }
    if (raw.type === 'assistant' && Array.isArray(raw.message?.content)) {
      const out: ChatEvent[] = [];
      const wasStreamed = streamed.has(raw.message.id ?? '');
      for (const block of raw.message.content) {
        if (block.type === 'text' && !wasStreamed && typeof block.text === 'string' && block.text) out.push({ type: 'text-block', text: block.text });
        else if (block.type === 'tool_use') out.push({ type: 'tool-use', id: String(block.id), name: String(block.name), input: block.input ?? {} });
      }
      return out;
    }
    if (raw.type === 'user' && Array.isArray(raw.message?.content)) {
      return raw.message.content
        .filter(block => block.type === 'tool_result')
        .map(block => ({ type: 'tool-result' as const, id: String(block.tool_use_id), output: outputText(block.content), isError: block.is_error === true }));
    }
    if (raw.type === 'result') {
      if (raw.is_error) {
        const message = outputText(raw.result) || (Array.isArray(raw.errors) ? raw.errors.join('\n') : '') || 'Claude reported an error.';
        return [{ type: 'error', kind: LOGIN_PATTERN.test(message) ? 'not-logged-in' : 'failed', message }];
      }
      return [{ type: 'turn-end' }];
    }
    return [];
  }

  function line(text: string): ChatEvent[] {
    if (!text.trim()) return [];
    let raw: RawLine | null;
    try { raw = JSON.parse(text) as RawLine | null; } catch { return []; }
    return convert(raw);
  }

  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      return lines.flatMap(line);
    },
    end() {
      const rest = buffer;
      buffer = '';
      return line(rest);
    },
  };
}
