// The shell command that continues a Cod chat in a terminal.

// Quotes text as one POSIX shell word: single quotes, an embedded single quote becomes '\''.
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function resumeCommand(folder: string, sessionId: string): string {
  return `cd ${shellQuote(folder)} && claude --resume ${sessionId}`;
}
