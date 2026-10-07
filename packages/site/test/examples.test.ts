import { describe, expect, it } from 'vitest';

import evaluateVectors from '../../../spec/vectors/evaluate.json';
import { run, sameDraft } from '../src/playground/draft';
import { examples } from '../src/playground/examples';

describe('the examples', () => {
  it('are every case in the shared vectors, none left out', () => {
    expect(examples.map((e) => e.name)).toEqual(evaluateVectors.cases.map((c) => c.name));
    expect(examples.length).toBeGreaterThanOrEqual(40);
  });

  for (const example of examples) {
    it(`the model, run through the page code, gives the recorded answer: ${example.name}`, () => {
      const outcome = run(example.draft);
      expect(outcome.kind).toBe('decision');
      if (outcome.kind === 'decision') expect(outcome.decision).toEqual(example.recorded);
    });
  }

  it('never share an input with another example that has a different recorded answer', () => {
    for (const a of examples) {
      const clashes = examples.filter(
        (b) => b !== a && sameDraft(a.draft, b.draft) && JSON.stringify(a.recorded) !== JSON.stringify(b.recorded),
      );
      expect(clashes.map((e) => e.name), a.name).toEqual([]);
    }
  });

  it('cover every reason the model can give, so the page shows each one', () => {
    const reasons = new Set(examples.map((e) => e.recorded.reason));
    expect([...reasons].sort()).toEqual(['AfterWindow', 'BalanceUnavailable', 'BeforeWindow', 'BelowMinimum', 'Inactive', 'None']);
  });
});
