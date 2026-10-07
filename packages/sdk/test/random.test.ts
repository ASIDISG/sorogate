import { describe, expect, it } from 'vitest';

import { generateEvaluate, generateValidate, Rng } from '../scripts/random-vectors.js';
import { evaluateFileSchema, validateFileSchema } from './vectorlib.js';

function generate(seed: number, count: number): { evaluate: string; validate: string } {
  return {
    evaluate: JSON.stringify(generateEvaluate(new Rng(seed), count, seed)),
    validate: JSON.stringify(generateValidate(new Rng(seed ^ 0x9e3779b9), count, seed)),
  };
}

describe('the random vector generator', () => {
  it('writes files that match the vector schemas, with the requested number of cases', () => {
    const files = generate(7, 60);
    expect(evaluateFileSchema.parse(JSON.parse(files.evaluate)).cases).toHaveLength(60);
    expect(validateFileSchema.parse(JSON.parse(files.validate)).cases).toHaveLength(60);
  });

  it('is deterministic: the same seed gives byte-identical files, another seed does not', () => {
    const a = generate(11, 40);
    const b = generate(11, 40);
    const c = generate(12, 40);
    expect(b).toEqual(a);
    expect(c.evaluate).not.toEqual(a.evaluate);
  });

  it('covers every denial reason and both validation outcomes', () => {
    const { evaluate, validate } = generate(3, 600);
    const reasons = new Set(evaluateFileSchema.parse(JSON.parse(evaluate)).cases.map((c) => c.expect.reason));
    expect([...reasons].sort()).toEqual(['AfterWindow', 'BalanceUnavailable', 'BeforeWindow', 'BelowMinimum', 'Inactive', 'None']);
    const outcomes = new Set(validateFileSchema.parse(JSON.parse(validate)).cases.map((c) => JSON.stringify(c.expect)));
    expect(outcomes.has('{"ok":true}')).toBe(true);
    for (const error of ['NoConditions', 'TooManyConditions', 'InvalidMinimum', 'InvalidTimeWindow', 'NotAContract']) {
      expect(outcomes.has(JSON.stringify({ ok: false, error })), error).toBe(true);
    }
  });
});
