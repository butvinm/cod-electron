import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, root } from '../helpers/electron';

export const longPath = '/' + 'p'.repeat(199);
export const longURL = 'https://example.invalid/' + 'u'.repeat(176);
export const sentence = 'This invented sentence explains how to read a reply comfortably without moving the chat sideways. '.repeat(12).trim();
export const longCode = `const wide = "${'code'.repeat(160)}";`;
export const structure = '# Orchard report\n\n## Details\n\n### Next steps\n\n- Parent bullet\n  - Nested bullet\n\n1. First step\n   1. Nested step\n2. Second step\n\nA **bold phrase** and an *italic phrase*.\n\n> Quoted advice';
export const table = '| Name | Status |\n| --- | --- |\n| Orchard | Ready |';
export const wideTable = `| ${Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`).join(' | ')} |\n| ${Array(12).fill('---').join(' | ')} |\n| ${Array(12).fill(`WideCell${'w'.repeat(48)}`).join(' | ')} |`;
export const languages = [
  { tag: 'ts', text: 'const value: string = "typescript";', keyword: 'const', string: 'typescript' },
  { tag: 'js', text: 'const value = "javascript";', keyword: 'const', string: 'javascript' },
  { tag: 'json', text: '{"value": "json", "enabled": true}', keyword: 'true', string: 'json' },
  { tag: 'py', text: 'return "python"', keyword: 'return', string: 'python' },
  { tag: 'rust', text: 'let value = "rust";', keyword: 'let', string: 'rust' },
  { tag: 'go', text: 'var value = "golang"', keyword: 'var', string: 'golang' },
  { tag: 'sh', text: 'if true; then echo "shell"; fi', keyword: 'if', string: 'shell' },
] as const;
export const fence = (tag: string, text: string) => `\`\`\`${tag}\n${text}\n\`\`\``;
export const linkURL = 'https://example.invalid/story-31?from=chat#details';
export const unsafeHTML = '<img src=x onerror="window.__story31Executed=true">\n\n<script>window.__story31Executed=true</script>';
export const streamChunks = [
  '# Stream report\n\nReading the ',
  `${longPath}\n\n\`\`\`ts\nconst wide = "`,
  `${'stream'.repeat(140)}";\n`,
  `\`\`\`\n\n${table}\n\nDone.`,
];
export const payloads: Record<string, string> = {
  AC1: `${sentence}\n\n${longPath}\n\n${longURL}\n\n${fence('ts', longCode)}`,
  AC2: structure,
  AC3: `${table}\n\n${wideTable}`,
  AC4: `Inline \`value\` example.\n\n${languages.map(language => fence(language.tag, language.text)).join('\n\n')}`,
  AC5: `[Read the reference](${linkURL})`,
  AC6: streamChunks.join(''),
  AC7: `# Safe reply\n\n${unsafeHTML}\n\n**Still safe**`,
};

type WireEvent = {
  type: string;
  event: { type: string; delta: { text: string } };
  message: { content: { text: string; input: { file_path: string } }[] };
  result: string;
};
type Step = { event?: WireEvent; gate?: string };
// Reuse the existing fake's wire envelopes, including its documented limitations.
function reply(text: string, chunks = [text]): Step[] {
  const template = JSON.parse(readFileSync(path.join(root, 'tests/fakes/claude/scenarios/stream.json'), 'utf8')).turns[0] as Step[];
  const steps: Step[] = [];
  let inserted = false;
  for (const step of template) {
    if (step.gate) continue;
    const event = step.event!;
    if (event.type === 'stream_event' && event.event.type === 'content_block_delta') {
      if (inserted) continue;
      inserted = true;
      chunks.forEach((chunk, index) => {
        if (index > 0) steps.push({ gate: `chunk-${index}` });
        const delta = structuredClone(step);
        delta.event!.event.delta.text = chunk;
        steps.push(delta);
      });
    } else {
      if (event.type === 'assistant') event.message.content[0].text = text;
      if (event.type === 'result') event.result = text;
      steps.push(step);
    }
  }
  return steps;
}

export function scenarioFor(ac: string) {
  const first = reply(payloads[ac], ac === 'AC6' ? streamChunks : undefined);
  if (ac === 'AC1') {
    const tools = JSON.parse(readFileSync(path.join(root, 'tests/fakes/claude/scenarios/tools.json'), 'utf8')).turns[0] as Step[];
    tools[1].event!.message.content[0].input.file_path = longPath;
    first.splice(1, 0, tools[1], tools[2]);
  }
  return { turns: [first, reply(payloads[ac])] };
}

export const test = base.extend<{ markdownFake: { release: (index: number) => void } }>({
  markdownFake: [async ({}, use, testInfo) => {
    const ac = testInfo.title.match(/^AC\d+/)?.[0];
    if (!ac || !payloads[ac]) throw new Error(`No story #31 payload for ${testInfo.title}`);
    const directory = mkdtempSync(path.join(tmpdir(), 'cod-story-31-'));
    const fake = path.join(directory, 'claude');
    cpSync(path.join(root, 'tests/fakes/claude'), fake, { recursive: true });
    const gates = path.join(directory, 'gates');
    mkdirSync(gates);
    writeFileSync(path.join(fake, 'scenarios/story-31.json'), JSON.stringify(scenarioFor(ac)));
    const overrides: Record<string, string | undefined> = {
      COD_CLAUDE_BIN: path.join(fake, 'claude'),
      COD_FAKE_CLAUDE_LOG: path.join(directory, 'fake.jsonl'),
      COD_FAKE_CLAUDE_GATES: gates,
      COD_FAKE_CLAUDE_SCENARIO: 'story-31',
      COD_TEST_RECORD_EXTERNAL_URLS: ac === 'AC5' ? '1' : undefined,
    };
    for (const name of Object.keys(process.env)) {
      if (/^(?:ANTHROPIC_.*(?:KEY|TOKEN|SECRET)|CLAUDE_.*(?:KEY|TOKEN|SECRET))$/i.test(name)) overrides[name] = undefined;
    }
    const previous = new Map(Object.keys(overrides).map(name => [name, process.env[name]]));
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    try {
      await use({ release: index => writeFileSync(path.join(gates, `chunk-${index}`), 'release') });
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }, { auto: true }],
});
