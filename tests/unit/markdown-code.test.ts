import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightRuns, languageName, shellRuns, decodeEntity, safeLink } from '../../src/renderer/markdown-code.ts';

const cut = (code: string, runs: { from: number; to: number; category: string }[]) => runs.map(run => `${run.category}:${code.slice(run.from, run.to)}`);

test('languageName reads the first word of a fence info string and maps aliases', () => {
  assert.equal(languageName('ts'), 'ts');
  assert.equal(languageName('TypeScript title=x'), 'ts');
  assert.equal(languageName('bash'), 'sh');
  assert.equal(languageName('rs'), 'rust');
  assert.equal(languageName(''), '');
  assert.equal(languageName('constructor'), 'constructor');
});

test('highlightRuns marks keywords and strings for the supported languages', () => {
  const samples: [string, string, string, string][] = [
    ['ts', 'const a = "x";', 'keyword:const', 'string:"x"'],
    ['py', 'def f(): return "x"', 'keyword:def', 'string:"x"'],
    ['go', 'func main() { println("x") }', 'keyword:func', 'string:"x"'],
    ['rust', 'fn main() { let s = "x"; }', 'keyword:fn', 'string:"x"'],
    ['json', '{"a": true, "b": "x"}', 'boolean:true', 'string:"x"'],
  ];
  for (const [language, code, keyword, string] of samples) {
    const found = cut(code, highlightRuns(language, code));
    assert.ok(found.includes(keyword), `${language}: ${found.join(' | ')}`);
    assert.ok(found.includes(string), `${language}: ${found.join(' | ')}`);
  }
});

test('highlightRuns has nothing for unknown languages and own-property names', () => {
  assert.deepEqual(highlightRuns('', 'const a = 1'), []);
  assert.deepEqual(highlightRuns('constructor', 'const a = 1'), []);
});

test('shellRuns finds keywords, strings, comments and variables', () => {
  const code = 'if true; then echo "a b" $HOME # note\nfi';
  assert.deepEqual(cut(code, shellRuns(code)), ['keyword:if', 'keyword:then', 'string:"a b"', 'variable.special:$HOME', 'comment:# note', 'keyword:fi']);
});

test('shellRuns copes with an unterminated string', () => {
  const code = 'echo "open';
  assert.deepEqual(cut(code, shellRuns(code)), ['string:"open']);
});

test('decodeEntity decodes known entities and leaves the rest', () => {
  assert.equal(decodeEntity('&amp;'), '&');
  assert.equal(decodeEntity('&#65;'), 'A');
  assert.equal(decodeEntity('&#x41;'), 'A');
  assert.equal(decodeEntity('&bogus;'), '&bogus;');
  assert.equal(decodeEntity('&#0;'), '&#0;');
});

test('safeLink allows only http, https and mailto', () => {
  assert.equal(safeLink('https://example.invalid/a'), 'https://example.invalid/a');
  assert.equal(safeLink('mailto:a@example.invalid'), 'mailto:a@example.invalid');
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('file:///etc/passwd'), null);
  assert.equal(safeLink('not a url'), null);
});
