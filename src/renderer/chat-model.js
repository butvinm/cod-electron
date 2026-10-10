// Pure chat transcript logic. No DOM here, so it is easy to test.
// A classic script like workspaces.js.
//
// A transcript is { items, busy, sessionId }. Items are never changed in place:
// each change returns a new state and new objects for the items that changed.
// Item kinds: user, assistant (state: streaming, complete, interrupted), tool, interrupted, error.
(function (root) {
  'use strict';

  function createChat() {
    return { items: [], busy: false, sessionId: null, nextKey: 1 };
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
      case 'turn-end':
        return { ...settle(state, 'complete'), busy: false };
      case 'error': {
        const message = event.kind === 'not-logged-in' ? LOGIN_HELP : event.message;
        return push(settle(state, 'complete'), { kind: 'error', message }, { busy: false });
      }
      case 'interrupted':
        return push(settle(state, 'interrupted'), { kind: 'interrupted' }, { busy: false });
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

  const api = { createChat, reduce, toolTarget, toolInputText, splitBlocks, LOGIN_HELP };
  if (typeof window !== 'undefined') window.ChatModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
