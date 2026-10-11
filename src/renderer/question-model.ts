// Pure logic for Claude's questions (the AskUserQuestion tool). No DOM here.

export const QUESTION_TOOL = 'AskUserQuestion';
export const DECLINED = 'The user declined to answer';

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  header: string;
  question: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

// What the person chose for one question: indexes into options, and the typed text of Other.
export interface Choice {
  picked: number[];
  other: string | null;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

// Reads the input of an AskUserQuestion call. Returns null when it is not usable,
// so the plain permission prompt can take over.
export function parseQuestions(input: unknown): Question[] | null {
  if (!input || typeof input !== 'object' || !('questions' in input) || !Array.isArray(input.questions)) return null;
  const questions: Question[] = [];
  for (const raw of input.questions as unknown[]) {
    if (!raw || typeof raw !== 'object') return null;
    const fields = raw as Record<string, unknown>;
    const question = asText(fields.question);
    if (!question || !Array.isArray(fields.options)) return null;
    const options: QuestionOption[] = [];
    for (const entry of fields.options as unknown[]) {
      const option = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      if (!asText(option.label)) return null;
      options.push({ label: asText(option.label), description: asText(option.description) });
    }
    questions.push({ header: asText(fields.header), question, multiSelect: fields.multiSelect === true, options });
  }
  return questions.length > 0 ? questions : null;
}

// The answer text Claude receives: the label, the labels joined with ", ", or the typed text.
export function answerText(question: Question, choice: Choice): string {
  const parts = choice.picked.slice().sort((a, b) => a - b).map(index => question.options[index].label);
  if (choice.other !== null && choice.other !== '') parts.push(choice.other);
  return parts.join(', ');
}

export function answersOf(questions: Question[], choices: Choice[]): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => { answers[question.question] = answerText(question, choices[index]); });
  return answers;
}

// A question is committed when it has an answer. Other needs its text.
export function isAnswered(choice: Choice): boolean {
  return choice.picked.length > 0 || (choice.other !== null && choice.other !== '');
}

// The option to focus after a key. Rows 0..count-1 are the supplied options, row count is Other.
// Returns the same row when the key does nothing.
export function nextRow(row: number, key: string, count: number): number {
  if (key === 'ArrowDown') return Math.min(count, row + 1);
  if (key === 'ArrowUp') return Math.max(0, row - 1);
  if (/^[1-4]$/.test(key) && Number(key) <= count) return Number(key) - 1;
  return row;
}
