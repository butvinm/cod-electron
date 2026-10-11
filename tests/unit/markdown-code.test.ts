import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightRuns, languageName, shellRuns, decodeEntity, safeLink, joinCodeSegments, linkDestination } from '../../src/renderer/markdown-code.ts';

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

// Node has no DOMParser. This stand-in knows two names and returns anything else unchanged, as the browser does.
class FakeDOMParser {
  parseFromString(entity: string): { documentElement: { textContent: string } } {
    const names: Record<string, string> = { '&amp;': '&', '&copy;': '©' };
    return { documentElement: { textContent: names[entity] ?? entity } };
  }
}
Object.assign(globalThis, { DOMParser: FakeDOMParser });

test('decodeEntity decodes named entities with the DOM parser and numeric ones itself', () => {
  assert.equal(decodeEntity('&amp;'), '&');
  assert.equal(decodeEntity('&copy;'), '©');
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

test('joinCodeSegments keeps every line of a fence split by container prefixes', () => {
  assert.equal(joinCodeSegments(['a\n', 'b']), 'a\nb');
  assert.equal(joinCodeSegments(['a\n', '\n', 'c']), 'a\n\nc');
  assert.equal(joinCodeSegments([]), '');
});

test('joinCodeSegments keeps blank lines at the end of the last segment', () => {
  assert.equal(joinCodeSegments(['a\n\n']), 'a\n\n');
  assert.equal(joinCodeSegments(['\n']), '\n');
  assert.equal(joinCodeSegments(['a\n', 'b\n']), 'a\nb\n');
});

test('linkDestination decodes entities and backslash escapes once', () => {
  assert.equal(linkDestination('https://example.invalid/?a=1&amp;b=2'), 'https://example.invalid/?a=1&b=2');
  assert.equal(linkDestination('https://example.invalid/?a=1&copy;=2'), 'https://example.invalid/?a=1©=2');
  assert.equal(linkDestination('https://example.invalid/a\\_b'), 'https://example.invalid/a_b');
  assert.equal(linkDestination('https://example.invalid/?x=&amp;amp;'), 'https://example.invalid/?x=&amp;');
  assert.equal(linkDestination('https://example.invalid/a\\b'), 'https://example.invalid/a\\b');
});
