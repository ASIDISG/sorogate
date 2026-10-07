import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as model from '../src/model.js';
import * as root from '../src/index.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every package a file in `src` imports, followed through the package's own files. */
function reachableImports(entry: string): { files: string[]; packages: string[] } {
  const files: string[] = [];
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.includes(file)) continue;
    files.push(file);
    const text = readFileSync(resolve(SRC, file), 'utf8');
    for (const match of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const target = match[1] as string;
      if (target.startsWith('.')) queue.push(target.replace(/^\.\//, '').replace(/\.js$/, '.ts'));
      else packages.add(target);
    }
  }
  return { files: files.sort(), packages: [...packages].sort() };
}

describe('the model entry point', () => {
  it('imports no package at all: nothing from the Stellar SDK reaches a page that only uses the model', () => {
    const { packages } = reachableImports('model.ts');
    expect(packages).toEqual([]);
  });

  it('this check does see imports: the root entry reaches the Stellar SDK', () => {
    expect(reachableImports('index.ts').packages).toContain('@stellar/stellar-sdk');
  });

  it('exports, from the same code, only things the package root exports too', () => {
    const rootExports = root as Record<string, unknown>;
    for (const [name, value] of Object.entries(model)) {
      expect(rootExports[name], `${name} is missing from the root entry`).toBe(value);
    }
  });

  it('is enough to work a policy out: validate, evaluate and explain', () => {
    const conditions = [{ type: 'time_window' as const, notBefore: 100n, notAfter: null }];
    expect(model.validateConditions(conditions).ok).toBe(true);
    const decision = model.evaluate(
      { version: 1, active: true, conditions },
      { timestamp: 99n, readings: new Map() },
    );
    expect(decision).toEqual({ allowed: false, version: 1, failedIndex: 0, reason: 'BeforeWindow' });
    expect(model.explainDecision(decision, conditions)).toContain('too early');
  });
});
