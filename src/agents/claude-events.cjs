'use strict';

// Turns the stream-json lines of the Claude CLI into the small event set the chat uses.
// This is the only place that knows the CLI's wire format. A second provider would
// produce the same events.
//
// Chat events:
//   { type: 'session', id }
//   { type: 'text', text }                      streamed fragment of the current reply
//   { type: 'text-block', text }                a whole reply block that was not streamed
//   { type: 'message-end' }
//   { type: 'tool-use', id, name, input }
//   { type: 'tool-result', id, output, isError }
//   { type: 'turn-end' }
//   { type: 'error', kind, message }            kind is 'not-logged-in' or 'failed'

const LOGIN_PATTERN = /not logged in|auth login|\/login|authentication|invalid api key|unauthorized|credentials/i;

function outputText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(block => (block && typeof block.text === 'string' ? block.text : '')).join('');
  }
  return content == null ? '' : JSON.stringify(content);
}

function createParser() {
  let buffer = '';
  // Message IDs whose text already arrived as deltas, so the final copy is not shown twice.
  const streamed = new Set();
  let currentMessage = null;

  function convert(raw) {
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
      const out = [];
      const wasStreamed = streamed.has(raw.message.id);
      for (const block of raw.message.content) {
        if (block.type === 'text' && !wasStreamed && block.text) out.push({ type: 'text-block', text: block.text });
        else if (block.type === 'tool_use') out.push({ type: 'tool-use', id: block.id, name: block.name, input: block.input ?? {} });
      }
      return out;
    }
    if (raw.type === 'user' && Array.isArray(raw.message?.content)) {
      return raw.message.content
        .filter(block => block.type === 'tool_result')
        .map(block => ({ type: 'tool-result', id: block.tool_use_id, output: outputText(block.content), isError: block.is_error === true }));
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

  function line(text) {
    if (!text.trim()) return [];
    let raw;
    try { raw = JSON.parse(text); } catch { return []; }
    return convert(raw);
  }

  return {
    // Feeds a chunk of stdout and returns the events for every complete line in it.
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      return lines.flatMap(line);
    },
    // Handles a last line that had no newline.
    end() {
      const rest = buffer;
      buffer = '';
      return line(rest);
    },
  };
}

module.exports = { createParser, outputText, LOGIN_PATTERN };
