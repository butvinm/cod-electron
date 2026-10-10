// The chat pane of one workspace. Its DOM is built once and kept, so the transcript, the
// draft and the focus survive the workbench redraws. Each event updates only the part it changes.
// The Claude process lives in the main process; this file only draws events and sends keys.
(function () {
  'use strict';
  const { createChat, reduce, toolTarget, toolInputText, splitBlocks, statusOf, permissionText } = window.ChatModel;

  function node(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'testid') n.dataset.testid = value;
      else if (key === 'text') n.textContent = value;
      else n.setAttribute(key, value);
    }
    n.append(...kids);
    return n;
  }

  // chatApi: { info(id), send(id, text), interrupt(id) }
  function create({ workspaceId, chatApi }) {
    let state = createChat();
    const nodes = new Map();       // item key -> { item, element }
    const expanded = new Set();    // item keys of open tool blocks

    const directory = node('span', { class: 'chat-directory', testid: 'chat-working-directory' });
    const sessionId = node('span', { class: 'chat-session-id', testid: 'chat-session-id', title: 'Resume this conversation in a terminal with: claude --resume <this ID>' });
    const session = node('span', { class: 'chat-session' }, node('span', { text: 'Session ' }), sessionId);
    session.hidden = true;
    const status = node('span', { class: 'chat-status', testid: 'chat-session-status', 'aria-live': 'polite', text: 'Ready' });
    const header = node('div', { class: 'chat-header' }, directory, session, status);
    const promptBox = node('div', { class: 'chat-permission', testid: 'chat-permission-prompt', role: 'group', 'aria-label': 'Permission request' });
    promptBox.hidden = true;
    const transcript = node('div', { class: 'chat-transcript', role: 'log', 'aria-label': 'Conversation' });
    const composer = node('textarea', {
      class: 'chat-composer',
      'aria-label': 'Message Claude',
      placeholder: 'Message Claude...',
      rows: '1',
      spellcheck: 'false',
    });
    const element = node('div', { class: 'claude-chat', testid: 'claude-chat', 'data-workspace-id': workspaceId },
      header, transcript, promptBox, node('div', { class: 'chat-input' }, composer));

    function growComposer() {
      // Set through the CSSOM, because the CSP blocks inline style attributes.
      composer.style.height = 'auto';
      composer.style.height = `${Math.min(composer.scrollHeight, 200)}px`;
    }

    function refreshInfo() {
      chatApi.info(workspaceId).then(info => {
        directory.textContent = info.home
          ? `Working in your home folder: ${info.cwd}`
          : `Working in ${info.cwd}`;
      }).catch(console.error);
    }

    function drawText(container, text) {
      container.replaceChildren(...splitBlocks(text).map(block => (block.type === 'code'
        ? node('pre', { class: 'chat-code', text: block.text })
        : node('p', { class: 'chat-paragraph', text: block.text.replace(/^\n+|\n+$/g, '') }))));
    }

    function buildTool(item) {
      const summary = node('button', { class: 'chat-tool-summary', type: 'button', 'aria-expanded': 'false' },
        node('span', { class: 'chat-tool-chevron', 'aria-hidden': 'true' }),
        node('span', { class: 'chat-tool-name', text: item.name }), ' ',
        node('span', { class: 'chat-tool-target', text: toolTarget(item.input) }));
      const body = node('div', { class: 'chat-tool-body' });
      const block = node('div', { class: 'chat-tool', testid: 'chat-tool-call' }, summary, body);
      summary.addEventListener('click', () => {
        const entry = [...nodes.values()].find(candidate => candidate.element === block);
        if (!entry) return;
        const key = entry.item.key;
        if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
        drawTool(block, entry.item);
      });
      return block;
    }

    function drawTool(block, item) {
      const open = expanded.has(item.key);
      block.querySelector('.chat-tool-summary').setAttribute('aria-expanded', String(open));
      const body = block.querySelector('.chat-tool-body');
      body.hidden = !open;
      block.classList.toggle('chat-tool-error', item.isError);
      if (!open) return;
      const kids = [
        node('div', { class: 'chat-tool-label', text: 'Input' }),
        node('pre', { class: 'chat-tool-text', testid: 'chat-tool-input', text: toolInputText(item.input) }),
      ];
      if (item.output !== null) {
        kids.push(node('div', { class: 'chat-tool-label', text: item.isError ? 'Error' : 'Output' }));
        kids.push(node('pre', { class: 'chat-tool-text', testid: 'chat-tool-output', text: item.output }));
      }
      body.replaceChildren(...kids);
    }

    function build(item) {
      switch (item.kind) {
        case 'user': return node('div', { class: 'chat-user', testid: 'chat-user-message', text: item.text });
        case 'assistant': return node('div', { class: 'chat-assistant', testid: 'chat-assistant-message' });
        case 'tool': return buildTool(item);
        case 'interrupted': return node('div', { class: 'chat-note', testid: 'chat-interrupted', text: 'Interrupted by you' });
        default: return node('div', { class: 'chat-error', testid: 'chat-error', role: 'alert', text: item.message });
      }
    }

    function update(element, item) {
      if (item.kind === 'assistant') {
        element.setAttribute('data-state', item.state);
        drawText(element, item.text);
      } else if (item.kind === 'tool') drawTool(element, item);
    }

    // The permission prompt: three choices, or the denial form after Deny or Esc.
    let shownId = null;
    let choices = [];
    let denying = false;
    let choiceBox = null;
    let reasonBox = null;
    let reasonInput = null;

    function answer(allow, scope, message) {
      const id = shownId;
      chatApi.permission(workspaceId, id, { allow, scope, message }).catch(console.error);
      apply({ type: 'permission-answered' });
    }

    function showDenial(on) {
      denying = on;
      choiceBox.hidden = on;
      reasonBox.hidden = !on;
      if (on) reasonInput.focus(); else choices[0].focus();
    }

    function buildPrompt(request) {
      const once = node('button', { type: 'button', class: 'chat-permission-choice', text: 'Allow once' });
      const forSession = node('button', { type: 'button', class: 'chat-permission-choice', 'aria-keyshortcuts': 'S', text: 'Allow for this session' });
      const deny = node('button', { type: 'button', class: 'chat-permission-choice', text: 'Deny' });
      once.addEventListener('click', () => answer(true, 'once'));
      forSession.addEventListener('click', () => answer(true, 'session'));
      deny.addEventListener('click', () => showDenial(true));
      choices = [once, forSession, deny];
      choiceBox = node('div', { class: 'chat-permission-choices' }, ...choices);
      reasonInput = node('input', { type: 'text', class: 'chat-permission-reason', 'aria-label': 'Denial reason', placeholder: 'Reason (optional)', spellcheck: 'false' });
      const send = node('button', { type: 'button', class: 'chat-permission-choice', text: 'Send denial' });
      send.addEventListener('click', () => answer(false, 'once', reasonInput.value.trim()));
      reasonBox = node('div', { class: 'chat-permission-choices' }, reasonInput, send);
      reasonBox.hidden = true;
      denying = false;
      const hint = node('div', { class: 'chat-permission-hint' },
        node('kbd', { text: 'Enter' }), ' allows once, ', node('kbd', { text: 'S' }), ' allows for this session, ', node('kbd', { text: 'Esc' }), ' denies');
      promptBox.replaceChildren(
        node('div', { class: 'chat-permission-title' }, 'Claude wants to use ', node('strong', { class: 'chat-permission-tool', text: request.tool })),
        node('pre', { class: 'chat-permission-input', text: permissionText(request.input) }),
        choiceBox, reasonBox, hint);
    }

    function drawPrompt() {
      const request = state.permission;
      if (!request) {
        if (shownId === null) return;
        const hadFocus = promptBox.contains(document.activeElement);
        shownId = null;
        promptBox.hidden = true;
        promptBox.replaceChildren();
        if (hadFocus) composer.focus();
        return;
      }
      if (shownId === request.id) return;
      shownId = request.id;
      buildPrompt(request);
      promptBox.hidden = false;
      // A prompt takes the focus unless the person is working somewhere else.
      const active = document.activeElement;
      if (!active || active === document.body || element.contains(active)) choices[0].focus();
    }

    promptBox.addEventListener('keydown', event => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (denying) {
        if (event.key === 'Enter' && event.target === reasonInput) {
          event.preventDefault();
          answer(false, 'once', reasonInput.value.trim());
        }
        return;
      }
      const at = choices.indexOf(document.activeElement);
      if (event.key === 's' && !event.shiftKey) {
        event.preventDefault();
        answer(true, 'session');
      } else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        choices[Math.max(0, Math.min(choices.length - 1, (at < 0 ? 0 : at) + step))].focus();
      }
    });

    function sync() {
      const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40;
      for (const item of state.items) {
        const entry = nodes.get(item.key);
        if (!entry) {
          const created = build(item);
          nodes.set(item.key, { item, element: created });
          update(created, item);
          transcript.append(created);
        } else if (entry.item !== item) {
          entry.item = item;
          update(entry.element, item);
        }
      }
      if (state.sessionId) {
        sessionId.textContent = state.sessionId;
        session.hidden = false;
      }
      element.classList.toggle('chat-busy', state.busy);
      status.textContent = statusOf(state);
      drawPrompt();
      if (nearBottom) transcript.scrollTop = transcript.scrollHeight;
    }

    function apply(event) {
      state = reduce(state, event);
      sync();
      // The process may have moved to another directory between turns.
      if (['turn-end', 'error', 'interrupted'].includes(event.type)) refreshInfo();
    }

    function submit() {
      const text = composer.value;
      // One turn at a time. Queued follow-ups are not part of this story.
      if (!text.trim() || state.busy) return;
      composer.value = '';
      growComposer();
      apply({ type: 'user-message', text });
      transcript.scrollTop = transcript.scrollHeight;
      chatApi.send(workspaceId, text).catch(error => {
        console.error(error);
        apply({ type: 'error', kind: 'failed', message: 'Could not send the message.' });
      });
    }

    composer.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      submit();
    });
    composer.addEventListener('input', growComposer);
    // Esc is routed here by the app, wherever focus is in the workspace.
    // Returns true when a running reply was interrupted.
    function interrupt() {
      // An open prompt takes Esc first: Esc denies, and Esc in the denial form goes back to the choices.
      if (state.permission) {
        showDenial(!denying);
        return true;
      }
      if (!state.busy) return false;
      chatApi.interrupt(workspaceId).catch(console.error);
      return true;
    }

    refreshInfo();
    return { element, apply, refreshInfo, interrupt, isBusy: () => state.busy, composer };
  }

  window.Chat = { create };
})();
