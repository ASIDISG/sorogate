import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const json = (path: string): Record<string, unknown> & { cases?: unknown[]; steps?: number; comparisons?: number; disagreements?: number } =>
  JSON.parse(read(path));

const SKIP = new Set(['node_modules', 'dist', 'target', '.astro', '.git', 'test_snapshots']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Every Markdown file that is documentation: the repository's own pages, not third-party ones. */
const MARKDOWN = walk(ROOT);

const withoutCode = (text: string): string => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

/** GitHub's slug for a heading: formatting stripped, lower case, punctuation dropped, spaces become hyphens. */
function slug(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function headingSlugs(text: string): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of text.replace(/```[\s\S]*?```/g, '').split('\n')) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m === null) continue;
    const base = slug(m[1] as string);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

describe('the links in the documents', () => {
  it('all resolve: every relative path exists and every heading link names a heading that is there', () => {
    const problems: string[] = [];
    for (const file of MARKDOWN) {
      const text = readFileSync(file, 'utf8');
      for (const match of withoutCode(text).matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const href = match[1] as string;
        if (/^(https?:|mailto:)/.test(href)) continue;
        const [path = '', anchor] = href.split('#') as [string, string | undefined];
        const target = path === '' ? file : resolve(dirname(file), path);
        const where = `${relative(ROOT, file)}: ${href}`;
        if (!existsSync(target)) {
          problems.push(`${where} (no such file)`);
          continue;
        }
        if (anchor !== undefined && anchor !== '' && target.endsWith('.md') && !headingSlugs(readFileSync(target, 'utf8')).has(anchor)) {
          problems.push(`${where} (no such heading)`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('are being checked at all: the documents were found', () => {
    const names = MARKDOWN.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    for (const expected of ['README.md', 'docs/README.md', 'docs/EVIDENCE.md', 'docs/DEPLOYMENT.md', 'docs/COSTS.md', 'spec/SPEC.md', 'packages/sdk/README.md']) {
      expect(names).toContain(expected);
    }
  });
});

describe('the documentation index', () => {
  const index = read('docs/README.md');

  it('answers every question the project promises to answer', () => {
    for (const topic of [
      'policy model',
      'each condition means',
      'decision is worked out',
      'TypeScript SDK',
      'from your own contract',
      'Authentication versus authorization',
      'public deployment',
      'Testnet limitation',
      'it costs',
      'Security assumptions',
      'Upgrade and administrator authority',
      'something fails',
      'Lifetimes and archival',
    ]) {
      expect(index, topic).toContain(topic);
    }
  });

  it('is linked from the README', () => {
    expect(read('README.md')).toContain('docs/README.md');
  });
});

describe('the evidence labels', () => {
  const LABELS = ['Unit-tested', 'Recorded', 'Live', 'Simulated', 'Example', 'Documented', 'Reasoning'];

  it('are each defined in docs/EVIDENCE.md', () => {
    const text = read('docs/EVIDENCE.md');
    for (const label of LABELS) expect(text, label).toMatch(new RegExp(`^\\| \\*\\*${label}\\*\\* \\|`, 'm'));
  });

  it('are the only ones the threat model uses: the old words for them are gone', () => {
    const text = read('docs/THREAT_MODEL.md');
    expect(text).not.toContain('**Tested**');
    expect(text).not.toContain('**Measured**');
    for (const label of ['Unit-tested', 'Recorded', 'Documented', 'Reasoning']) expect(text, label).toContain(`**${label}**`);
  });

  it('are used by every recorded note and by the pages that report numbers from the network', () => {
    const notes = walk(join(ROOT, 'docs/evidence')).map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(notes.length).toBeGreaterThanOrEqual(8);
    for (const note of [...notes, 'docs/COSTS.md']) {
      expect(read(note).split('\n').slice(0, 12).join('\n'), note).toMatch(/\*\*Label: Recorded[.,]/);
    }
    expect(read('docs/COSTS.md')).toMatch(/every figure is Simulated/);
    expect(read('docs/DEPLOYMENT.md')).toMatch(/Label: \*\*Live\*\*/);
  });

  it('are the only words used after "Label:" anywhere', () => {
    for (const file of MARKDOWN) {
      for (const match of readFileSync(file, 'utf8').matchAll(/Label: \*{0,2}([A-Za-z-]+)/g)) {
        expect(LABELS, `${relative(ROOT, file)}: "${match[1]}"`).toContain(match[1]);
      }
    }
  });
});

describe('the status of the project', () => {
  const MUST_SAY_SO = [
    'README.md',
    'SECURITY.md',
    'docs/ARCHITECTURE.md',
    'docs/INTEGRATING.md',
    'docs/CREDENTIALS.md',
    'docs/DEPLOYMENT.md',
    'docs/THREAT_MODEL.md',
    'spec/SPEC.md',
    'packages/sdk/README.md',
    'packages/site/README.md',
  ];

  it('is stated near the top of every page a reader might land on first', () => {
    for (const page of MUST_SAY_SO) {
      const top = read(page).split('\n').slice(0, 14).join('\n');
      expect(top, page).toMatch(/testnet/i);
      expect(top, page).toMatch(/not audited|unaudited|not been audited/i);
    }
  });

  it('is never contradicted by a claim of audit, production use or mainnet readiness', () => {
    for (const file of MARKDOWN) {
      const text = withoutCode(readFileSync(file, 'utf8'));
      const name = relative(ROOT, file).replaceAll('\\', '/');
      if (name === 'docs/EVIDENCE.md') continue; // it lists these words as things the project does not claim
      expect(text, name).not.toMatch(/\b(has been audited|was audited|is audited|audited by|production[- ]ready|ready for (mainnet|production)|battle[- ]tested)\b/i);
    }
  });
});

describe('the numbers the README states about tests and about recorded runs', () => {
  const readme = read('README.md');

  it('match the contract tests and the shared vectors', () => {
    const unit = Number(/(\d+) unit tests/.exec(readme)?.[1]);
    expect(unit).toBe((read('contracts/access-policy/src/test.rs').match(/#\[test\]/g) ?? []).length);

    const m = /(\d+) shared test cases \((\d+) decisions, (\d+) validity checks\)/.exec(readme);
    expect(m, 'the README states the number of shared test cases').not.toBeNull();
    const evaluate = json('spec/vectors/evaluate.json').cases?.length;
    const validate = json('spec/vectors/validate.json').cases?.length;
    expect([Number(m?.[2]), Number(m?.[3]), Number(m?.[1])]).toEqual([evaluate, validate, (evaluate ?? 0) + (validate ?? 0)]);
    expect(read('docs/THREAT_MODEL.md')).toContain(`${(evaluate ?? 0) + (validate ?? 0)} shared vectors`);
  });

  it('match the recorded runs they quote', () => {
    const differential = json('docs/evidence/testnet-differential-2026-10-07.json');
    expect(differential.disagreements).toBe(0);
    expect(readme).toContain(`agreed on ${differential.comparisons} comparisons`);
    expect(readme).toContain(`${json('docs/evidence/testnet-gated-claim-2026-10-07.json').steps} steps, all as expected`);
    expect(readme).toContain(`${json('docs/evidence/testnet-sep50-2026-10-07.json').steps} steps, contract and model agreeing`);
  });

  it('say that every step of those runs happened as expected, because the files do', () => {
    for (const name of ['gated-claim', 'sep50', 'sdk-writes']) {
      const run = json(`docs/evidence/testnet-${name}-2026-10-07.json`) as { unexpected?: number };
      expect(run.unexpected, name).toBe(0);
    }
  });
});
