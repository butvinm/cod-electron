// Pure chat transcript logic. No DOM here, so it is easy to test.
// A classic script like workspaces.js.
//
// A transcript is { items, busy, sessionId }. Items are never changed in place:
// each change returns a new state and new objects for the items that changed.
// Item kinds: user, assistant (state: streaming, complete, interrupted), tool, interrupted, error.
(function (root) {
  'use strict';

  function createChat() {
    return { items: [], busy: false, sessionId: null, permission: null, permissions: [], nextKey: 1 };
  }

  // permission is always the first waiting request, or null.
  function withQueue(state, permissions) {
    return { ...state, permissions, permission: permissions[0] || null };
  }

  // The session status shown in the chat header.
  function statusOf(state) {
    if (state.permission) return 'Needs input';
    return state.busy ? 'Working' : 'Ready';
  }

  // The full text of a tool input for the permission prompt: a command as it is, anything else as JSON.
  function permissionText(input) {
    if (input && typeof input === 'object' && typeof input.command === 'string') return input.command;
    return toolInputText(input);
  }

  const LOGIN_HELP = 'Claude is not logged in. Run `claude auth login` in a terminal, then send your message again.';

  function push(state, item, patch = {}) {
    return { ...state, ...patch, items: [...state.items, { ...item, key: state.nextKey }], nextKey: state.nextKey + 1 };
  }

  // Marks every streaming reply as finished (state complete or interrupted).
  function settle(state, to) {
    if (!state.items.some(item => item.kind === 'assistant' && item.state === 'streaming')) return state;
    return { ...state, items: state.items.map(item => (item.kind === 'assistant' && item.state === 'streaming' ? { ...item, state: to } : item)) };
  }

  function reduce(state, event) {
    switch (event.type) {
      case 'user-message':
        return push(state, { kind: 'user', text: event.text }, { busy: true });
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
  function toolTarget(input) {
    if (!input || typeof input !== 'object') return '';
    for (const name of ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description']) {
      if (typeof input[name] === 'string' && input[name]) return input[name].split('\n')[0];
    }
    const first = Object.values(input).find(value => typeof value === 'string' && value);
    return first ? first.split('\n')[0] : '';
  }

  function toolInputText(input) {
    return JSON.stringify(input ?? {}, null, 2);
  }

  // Splits reply text into paragraphs and fenced code blocks. An unclosed fence, as in a
  // reply that is still streaming, counts as code up to the end.
  function splitBlocks(text) {
    const blocks = [];
    const fence = /```[^\n]*\n?([\s\S]*?)(?:```|$)/g;
    let from = 0;
    let match;
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
  function queueHint(waiting) {
    return waiting > 1 ? `1 of ${waiting}` : '';
  }

  // Where the focus goes when it enters a chat with a waiting prompt.
  function promptFocusTarget({ denying, choice, count }) {
    if (denying) return { kind: 'reason' };
    return { kind: 'choice', index: Math.max(0, Math.min(count - 1, choice || 0)) };
  }

  const api = { createChat, reduce, queueHint, promptFocusTarget, statusOf, permissionText, toolTarget, toolInputText, splitBlocks, LOGIN_HELP };
  if (typeof window !== 'undefined') window.ChatModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
