// The question card of the chat: Claude's AskUserQuestion shown as questions with options.
// Keyboard: Down/Up or 1-4 move between options, Enter chooses (single) or commits (multiple)
// and moves on, Space toggles in a multiple-choice question, Esc is handled by the chat (declines).
import { answersOf, isAnswered, nextRow, type Choice, type Question } from './question-model.ts';

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

let counter = 0;

export interface QuestionForm {
  element: HTMLElement;
  focusFirst(): void;
  // Focus returns to the option or field that last had it, or to the first option.
  focusCurrent(): void;
}

export function createQuestionForm(questions: Question[], onSubmit: (answers: Record<string, string>) => void): QuestionForm {
  const choices: Choice[] = questions.map(() => ({ picked: [], other: null }));
  const rows: HTMLElement[][] = [];          // per question: option rows, then the Other row
  const inputs: HTMLInputElement[] = [];     // per question: the Other answer field
  const last: number[] = questions.map(() => 0);
  let lastQuestion = 0;

  const submit = node('button', { type: 'button', class: 'chat-question-submit', text: 'Submit' });
  const hint = node('div', { class: 'chat-question-hint' },
    node('kbd', { text: 'Up' }), ' ', node('kbd', { text: 'Down' }), ' or ', node('kbd', { text: '1-4' }), ' move, ',
    node('kbd', { text: 'Enter' }), ' chooses, ', node('kbd', { text: 'Space' }), ' toggles, ', node('kbd', { text: 'Esc' }), ' declines');

  function redraw(qi: number): void {
    const question = questions[qi];
    const choice = choices[qi];
    const active = choice.other !== null;
    rows[qi].forEach((row, index) => {
      const on = index < question.options.length ? choice.picked.includes(index) : active;
      row.setAttribute('aria-checked', String(on));
    });
    const input = inputs[qi];
    input.hidden = !active;
  }

  function focusRow(qi: number, row: number): void {
    rows[qi][row].focus();
  }

  function advance(qi: number): void {
    if (qi + 1 < questions.length) focusRow(qi + 1, 0); else submit.focus();
  }

  function send(): void {
    const missing = choices.findIndex(choice => !isAnswered(choice));
    if (missing >= 0) { focusRow(missing, 0); return; }
    onSubmit(answersOf(questions, choices));
  }

  // Chooses the focused row. For single choice it replaces the answer; for multiple choice it toggles.
  function choose(qi: number, row: number, toggle: boolean): void {
    const question = questions[qi];
    const choice = choices[qi];
    const isOther = row === question.options.length;
    if (isOther) {
      if (question.multiSelect && choice.other !== null && toggle) {
        choice.other = null;
      } else {
        if (!question.multiSelect) choice.picked = [];
        choice.other = choice.other ?? '';
      }
      redraw(qi);
      if (choice.other !== null) inputs[qi].focus();
      return;
    }
    if (question.multiSelect) {
      choice.picked = choice.picked.includes(row) ? choice.picked.filter(index => index !== row) : [...choice.picked, row];
    } else {
      choice.picked = [row];
      choice.other = null;
    }
    redraw(qi);
  }

  const groups = questions.map((question, qi) => {
    const id = `chat-question-${++counter}`;
    const kind = question.multiSelect ? 'checkbox' : 'radio';
    const list: HTMLElement[] = [];
    const entries = [...question.options, { label: 'Other', description: '' }];
    entries.forEach((entry, row) => {
      const other = row === question.options.length;
      const label = node('span', { class: 'chat-question-label', id: `${id}-l${row}`, text: entry.label });
      const described = entry.description !== '';
      const props: Record<string, string> = {
        class: 'chat-question-option', role: kind, tabindex: row === 0 ? '0' : '-1', 'aria-checked': 'false', 'aria-labelledby': `${id}-l${row}`,
        'data-question': String(qi), 'data-row': String(row),
      };
      if (described) props['aria-describedby'] = `${id}-d${row}`;
      const marker = node('span', { class: `chat-question-marker chat-question-${kind}`, 'aria-hidden': 'true' });
      const number = node('span', { class: 'chat-question-number', 'aria-hidden': 'true', text: other || row > 3 ? '' : String(row + 1) });
      const text = node('span', { class: 'chat-question-text' }, label);
      if (described) text.append(node('span', { class: 'chat-question-description', id: `${id}-d${row}`, text: entry.description }));
      const option = node('div', props, marker, text, number);
      option.addEventListener('focus', () => {
        last[qi] = row;
        lastQuestion = qi;
        list.forEach((candidate, index) => candidate.setAttribute('tabindex', index === row ? '0' : '-1'));
      });
      option.addEventListener('click', () => {
        option.focus();
        choose(qi, row, true);
        if (!question.multiSelect && !other) advance(qi);
      });
      list.push(option);
    });
    rows.push(list);
    const input = node('input', { type: 'text', class: 'chat-question-other', 'aria-label': 'Other answer', placeholder: 'Type your answer', spellcheck: 'false' });
    input.hidden = true;
    input.addEventListener('input', () => { choices[qi].other = input.value; });
    input.addEventListener('focus', () => { lastQuestion = qi; last[qi] = question.options.length; });
    inputs.push(input);
    return node('div', { class: 'chat-question-group', role: 'group', 'aria-label': question.question },
      node('div', { class: 'chat-question-header', text: question.header }),
      node('div', { class: 'chat-question-ask', text: question.question }),
      node('div', { class: 'chat-question-options' }, ...list, input));
  });

  const element = node('div', { class: 'chat-question', testid: 'chat-question-form' },
    ...groups, node('div', { class: 'chat-question-actions' }, submit, hint));
  questions.forEach((_, qi) => redraw(qi));

  submit.addEventListener('click', send);
  element.addEventListener('keydown', event => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target instanceof HTMLInputElement) {
      const qi = inputs.indexOf(target);
      if (qi < 0) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (target.value.trim() === '') return;
        choices[qi].other = target.value;
        if (!questions[qi].multiSelect) choices[qi].picked = [];
        redraw(qi);
        advance(qi);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusRow(qi, questions[qi].options.length);
      }
      return;
    }
    if (!target.classList.contains('chat-question-option')) return;
    const qi = Number(target.dataset.question);
    const row = Number(target.dataset.row);
    const question = questions[qi];
    const moved = nextRow(row, event.key, question.options.length);
    if (['ArrowDown', 'ArrowUp'].includes(event.key) || /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      if (moved !== row) focusRow(qi, moved);
    } else if (event.key === ' ') {
      event.preventDefault();
      choose(qi, row, true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const other = row === question.options.length;
      if (other) { choose(qi, row, false); return; }
      if (question.multiSelect) {
        if (!isAnswered(choices[qi])) choose(qi, row, true);
      } else choose(qi, row, false);
      advance(qi);
    }
  });
  submit.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(questions.length - 1, last[questions.length - 1]);
    }
  });

  return {
    element,
    focusFirst: () => focusRow(0, 0),
    focusCurrent: () => {
      const row = rows[lastQuestion][last[lastQuestion]];
      (row.getAttribute('data-row') !== String(questions[lastQuestion].options.length) || inputs[lastQuestion].hidden ? row : inputs[lastQuestion]).focus();
    },
  };
}
