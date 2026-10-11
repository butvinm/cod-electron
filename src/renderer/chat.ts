// The chat pane of one workspace. Its DOM is built once and kept, so the transcript, the
// draft and the focus survive the workbench redraws. Each event updates only the part it changes.
// The Claude process lives in the main process; this file only draws events and sends keys.
import type { CodApi } from '../shared/ipc.ts';
import { createChat, reduce, toolTarget, toolInputText, statusOf, permissionText, queueHint, promptFocusTarget, type ChatItem, type ChatModelEvent, type PermissionRequest } from './chat-model.ts';
import { renderMarkdown } from './markdown.ts';
import { createModeSelector } from './chat-mode.ts';
import { nextPermissionMode, type PermissionMode, type SessionEvent } from '../shared/chat.ts';
import { createQuestionForm, type QuestionForm } from './chat-question.ts';
import { parseQuestions, DECLINED, QUESTION_TOOL, type Question } from './question-model.ts';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'testid') n.dataset.testid = value;
    else if (key === 'text') n.textContent = value;
    else n.setAttribute(key, value);
  }
  n.append(...kids);
  return n;
}

export interface ChatOptions {
  workspaceId: string;
  chatApi: CodApi['chat'];
  // The header button asks the app to open the session picker.
  openHistory?: () => void;
}

// A clock with a counter-clockwise arrow, like Zed's history icon.
function historyIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [name, value] of Object.entries({ width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
  for (const d of ['M2.5 8a5.5 5.5 0 1 0 1.6-3.9', 'M2.5 2.5v2.8h2.8', 'M8 5v3l2 1.2']) {
    const path = document.createElementNS(ns, 'path');
    for (const [name, value] of Object.entries({ d, stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(name, value);
    svg.append(path);
  }
  return svg;
}

export interface ChatView {
  element: HTMLElement;
  apply(event: ChatModelEvent): void;
  // The past turns of an opened CLI session, drawn in one go.
  load(events: SessionEvent[]): void;
  refreshInfo(): void;
  // Esc is routed here by the app, wherever focus is in the workspace.
  // Returns true when a running reply was interrupted or a prompt took the key.
  interrupt(): boolean;
  hasPermission(): boolean;
  focusPrompt(): boolean;
  isBusy(): boolean;
  composer: HTMLTextAreaElement;
}

export function create({ workspaceId, chatApi, openHistory = () => {} }: ChatOptions): ChatView {
  let state = createChat();
  const nodes = new Map<number, { item: ChatItem; element: HTMLElement }>(); // item key -> drawn item
  const expanded = new Set<number>();    // item keys of open tool blocks

  const directory = node('span', { class: 'chat-directory', testid: 'chat-working-directory' });
  const sessionId = node('span', { class: 'chat-session-id', testid: 'chat-session-id', title: 'Resume this conversation in a terminal with: claude --resume <this ID>' });
  const session = node('span', { class: 'chat-session' }, node('span', { text: 'Session ' }), sessionId);
  session.hidden = true;
  const status = node('span', { class: 'chat-status', testid: 'chat-session-status', 'aria-live': 'polite', text: 'Ready' });
  // Opens the Claude session picker (Cmd-G / Ctrl-G does the same).
  const historyButton = node('button', { class: 'chat-history-button', type: 'button', 'aria-label': 'Claude session history', title: 'Claude session history' }, historyIcon());
  historyButton.addEventListener('click', () => openHistory());
  const header = node('div', { class: 'chat-header' }, directory, session, historyButton, status);
  const folderNotice = node('div', { class: 'chat-folder-notice', testid: 'chat-folder-notice', role: 'status' });
  folderNotice.hidden = true;
  const promptBox = node('div', { class: 'chat-permission', testid: 'chat-permission-prompt', role: 'group', 'aria-label': 'Permission request' });
  promptBox.hidden = true;
  const questionBox = node('div', { class: 'chat-question-box' });
  questionBox.hidden = true;
  const transcript = node('div', { class: 'chat-transcript', role: 'log', 'aria-label': 'Conversation' });
  const composer = node('textarea', {
    class: 'chat-composer',
    'aria-label': 'Message Claude',
    placeholder: 'Message Claude...',
    rows: '1',
    spellcheck: 'false',
  });
  // Set a mode: shown at once, then sent on. The main process answers events only for modes Claude reports itself.
  const modeSelector = createModeSelector(chooseMode);
  function chooseMode(mode: PermissionMode): void {
    apply({ type: 'mode', mode });
    chatApi.setMode(workspaceId, mode).catch(console.error);
  }
  const element = node('div', { class: 'claude-chat', testid: 'claude-chat', 'data-workspace-id': workspaceId },
    header, folderNotice, transcript, promptBox, questionBox, node('div', { class: 'chat-input', testid: 'chat-composer-area' }, composer, modeSelector.element));

  function growComposer(): void {
    // Set through the CSSOM, because the CSP blocks inline style attributes.
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, 200)}px`;
  }

  function refreshInfo(): void {
    chatApi.info(workspaceId).then(info => {
      directory.textContent = info.home
        ? `Working in your home folder: ${info.cwd}`
        : `Working in ${info.cwd}`;
      folderNotice.textContent = info.notice ?? '';
      folderNotice.hidden = !info.notice;
    }).catch(console.error);
  }

  function drawText(container: HTMLElement, text: string): void {
    container.replaceChildren(...renderMarkdown(text));
  }

  // Links in replies go to the system browser. The window itself never navigates.
  function openLink(event: Event): void {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (!anchor || !transcript.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (href && event.type === 'click') chatApi.openLink(href).catch(console.error);
  }
  transcript.addEventListener('click', openLink);
  transcript.addEventListener('auxclick', openLink);

  function buildTool(item: ToolItem): HTMLElement {
    const summary = node('button', { class: 'chat-tool-summary', type: 'button', 'aria-expanded': 'false' },
      node('span', { class: 'chat-tool-chevron', 'aria-hidden': 'true' }),
      node('span', { class: 'chat-tool-name', text: item.name }), ' ',
      node('span', { class: 'chat-tool-target', text: toolTarget(item.input) }));
    const body = node('div', { class: 'chat-tool-body' });
    const block = node('div', { class: 'chat-tool', testid: 'chat-tool-call' }, summary, body);
    summary.addEventListener('click', () => {
      const entry = [...nodes.values()].find(candidate => candidate.element === block);
      if (!entry || entry.item.kind !== 'tool') return;
      const key = entry.item.key;
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      drawTool(block, entry.item);
    });
    return block;
  }

  function drawTool(block: HTMLElement, item: ToolItem): void {
    const open = expanded.has(item.key);
    block.querySelector('.chat-tool-summary')?.setAttribute('aria-expanded', String(open));
    const body = block.querySelector<HTMLElement>('.chat-tool-body');
    if (!body) return;
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

  // A submitted question card: each question with its answer; the button opens the options too.
  function buildQuestions(item: Extract<ChatItem, { kind: 'questions' }>): HTMLElement {
    const toggle = node('button', { class: 'chat-tool-summary', type: 'button', 'aria-expanded': 'false' },
      node('span', { class: 'chat-tool-chevron', 'aria-hidden': 'true' }), node('span', { class: 'chat-tool-name', text: 'Questions and answers' }));
    const rows = item.questions.map(question => {
      const detail = node('div', { class: 'chat-question-detail' }, ...question.options.map(option =>
        node('div', { text: `${option.label}: ${option.description}` })));
      detail.hidden = true;
      return node('div', { class: 'chat-question-answer', testid: 'chat-question-answer' },
        node('span', { class: 'chat-question-asked', text: question.question }), ' ',
        node('span', { class: 'chat-question-given', text: item.answers[question.question] ?? '' }), detail);
    });
    const block = node('div', { class: 'chat-tool chat-question-history', testid: 'chat-question-history' }, toggle, ...rows);
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      block.querySelectorAll<HTMLElement>('.chat-question-detail').forEach(detail => { detail.hidden = !open; });
    });
    return block;
  }

  function build(item: ChatItem): HTMLElement {
    switch (item.kind) {
      case 'user': return node('div', { class: 'chat-user', testid: 'chat-user-message', text: item.text });
      case 'assistant': return node('div', { class: 'chat-assistant', testid: 'chat-assistant-message' });
      case 'tool': return buildTool(item);
      case 'questions': return buildQuestions(item);
      case 'interrupted': return node('div', { class: 'chat-note', testid: 'chat-interrupted', text: 'Interrupted by you' });
      default: return node('div', { class: 'chat-error', testid: 'chat-error', role: 'alert', text: item.message });
    }
  }

  function update(drawn: HTMLElement, item: ChatItem): void {
    if (item.kind === 'assistant') {
      drawn.setAttribute('data-state', item.state);
      drawText(drawn, item.text);
    } else if (item.kind === 'tool') drawTool(drawn, item);
  }

  // The permission prompt: three choices, or the denial form after Deny or Esc.
  // The controls below are created by buildPrompt, which runs before any of them is used.
  let shownId: string | null = null;
  let choices: HTMLButtonElement[] = [];
  let denying = false;
  let choiceBox!: HTMLElement;
  let reasonBox!: HTMLElement;
  let reasonInput!: HTMLInputElement;

  let questionForm: QuestionForm | null = null;
  let lastChoice = 0;
  let countHint!: HTMLElement;

  function answer(allow: boolean, scope: 'once' | 'session', message?: string): void {
    const id = shownId;
    if (id === null) return;
    chatApi.permission(workspaceId, id, { allow, scope, message }).catch(console.error);
    apply({ type: 'permission-answered', id });
  }

  function showDenial(on: boolean): void {
    denying = on;
    choiceBox.hidden = on;
    reasonBox.hidden = !on;
    if (on) reasonInput.focus(); else choices[0].focus();
  }

  // Moves the focus to the prompt's current choice, or to the denial form when it is open.
  function focusPrompt(): boolean {
    if (!state.permission || shownId === null) return false;
    if (questionForm) { questionForm.focusCurrent(); return true; }
    const target = promptFocusTarget({ denying, choice: lastChoice, count: choices.length });
    (target.kind === 'reason' ? reasonInput : choices[target.index]).focus();
    return true;
  }

  function buildPrompt(request: PermissionRequest): void {
    const once = node('button', { type: 'button', class: 'chat-permission-choice', text: 'Allow once' });
    const forSession = node('button', { type: 'button', class: 'chat-permission-choice', 'aria-keyshortcuts': 'S', text: 'Allow for this session' });
    const deny = node('button', { type: 'button', class: 'chat-permission-choice', text: 'Deny' });
    once.addEventListener('click', () => answer(true, 'once'));
    forSession.addEventListener('click', () => answer(true, 'session'));
    deny.addEventListener('click', () => showDenial(true));
    choices = [once, forSession, deny];
    lastChoice = 0;
    choices.forEach((choice, index) => choice.addEventListener('focus', () => { lastChoice = index; }));
    countHint = node('span', { class: 'chat-permission-count' });
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
      node('div', { class: 'chat-permission-title' }, 'Claude wants to use ', node('strong', { class: 'chat-permission-tool', text: request.tool }), ' ', countHint),
      node('pre', { class: 'chat-permission-input', text: permissionText(request.input) }),
      choiceBox, reasonBox, hint);
  }

  // Claude's questions replace the permission prompt for AskUserQuestion.
  function buildQuestionCard(id: string, questions: Question[]): QuestionForm {
    const form = createQuestionForm(questions, answers => {
      chatApi.permission(workspaceId, id, { allow: true, scope: 'once', answers }).catch(console.error);
      apply({ type: 'questions-answered', id, questions, answers });
    });
    questionForm = form;
    questionBox.replaceChildren(form.element);
    return form;
  }

  function decline(): void {
    const id = shownId;
    if (id === null) return;
    chatApi.permission(workspaceId, id, { allow: false, scope: 'once', message: DECLINED }).catch(console.error);
    apply({ type: 'permission-answered', id });
  }

  function drawPrompt(): void {
    const request = state.permission;
    if (!request) {
      if (shownId === null) return;
      const hadFocus = promptBox.contains(document.activeElement) || questionBox.contains(document.activeElement);
      shownId = null;
      questionForm = null;
      promptBox.hidden = true;
      promptBox.replaceChildren();
      questionBox.hidden = true;
      questionBox.replaceChildren();
      if (hadFocus) composer.focus();
      return;
    }
    if (shownId === request.id) {
      if (!questionForm) countHint.textContent = queueHint(state.permissions.length);
      return;
    }
    shownId = request.id;
    const questions = request.tool === QUESTION_TOOL ? parseQuestions(request.input) : null;
    let opened: QuestionForm | null = null;
    questionForm = null;
    if (questions) {
      promptBox.hidden = true;
      promptBox.replaceChildren();
      opened = buildQuestionCard(request.id, questions);
      questionBox.hidden = false;
    } else {
      questionBox.hidden = true;
      questionBox.replaceChildren();
      buildPrompt(request);
      countHint.textContent = queueHint(state.permissions.length);
      promptBox.hidden = false;
    }
    // A prompt takes the focus unless the person is working somewhere else.
    const active = document.activeElement;
    if (!active || active === document.body || element.contains(active)) {
      if (opened) opened.focusFirst(); else choices[0].focus();
    }
  }

  // Focus entering the chat (composer, pane) while a prompt waits goes to the prompt, so Enter never reaches the busy composer.
  element.addEventListener('focusin', event => {
    if (state.permission && !(event.target instanceof Node && (promptBox.contains(event.target) || questionBox.contains(event.target)))) focusPrompt();
  });

  promptBox.addEventListener('keydown', event => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (denying) {
      if (event.key === 'Enter' && event.target === reasonInput) {
        event.preventDefault();
        answer(false, 'once', reasonInput.value.trim());
      }
      return;
    }
    const at = choices.findIndex(choice => choice === document.activeElement);
    if (event.key === 's' && !event.shiftKey) {
      event.preventDefault();
      answer(true, 'session');
    } else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      choices[Math.max(0, Math.min(choices.length - 1, (at < 0 ? 0 : at) + step))].focus();
    }
  });

  function sync(): void {
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
    modeSelector.show(state.mode);
    drawPrompt();
    if (nearBottom) transcript.scrollTop = transcript.scrollHeight;
  }

  function apply(event: ChatModelEvent): void {
    state = reduce(state, event);
    sync();
    // The process may have moved to another directory between turns.
    if (['turn-end', 'error', 'interrupted'].includes(event.type)) refreshInfo();
  }

  function submit(): void {
    const text = composer.value;
    // One turn at a time. Queued follow-ups are not part of this story.
    if (!text.trim() || state.busy) return;
    composer.value = '';
    growComposer();
    apply({ type: 'user-message', text });
    transcript.scrollTop = transcript.scrollHeight;
    chatApi.send(workspaceId, text).catch((error: unknown) => {
      console.error(error);
      apply({ type: 'error', kind: 'failed', message: 'Could not send the message.' });
    });
  }

  // Fills the chat with the past turns of a stored session. They are drawn once, not event by event.
  function load(events: SessionEvent[]): void {
    for (const event of events) state = reduce(state, event);
    sync();
    transcript.scrollTop = transcript.scrollHeight;
  }

  composer.addEventListener('keydown', event => {
    // Shift+Tab cycles the permission mode, as in Claude Code. The focus and the draft stay.
    if (event.key === 'Tab' && event.shiftKey && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      chooseMode(nextPermissionMode(state.mode));
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submit();
  });
  composer.addEventListener('input', growComposer);

  function interrupt(): boolean {
    // An open prompt takes Esc first: Esc denies, and Esc in the denial form goes back to the choices.
    if (state.permission) {
      if (questionForm) decline(); else showDenial(!denying);
      return true;
    }
    if (!state.busy) return false;
    chatApi.interrupt(workspaceId).catch(console.error);
    return true;
  }

  refreshInfo();
  chatApi.mode(workspaceId).then(mode => apply({ type: 'mode', mode })).catch(console.error);
  return { element, apply, load, refreshInfo, interrupt, hasPermission: () => state.permission !== null, focusPrompt, isBusy: () => state.busy, composer };
}
