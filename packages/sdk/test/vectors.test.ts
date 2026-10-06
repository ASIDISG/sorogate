import { describe, expect, it } from 'vitest';

import { evaluate, MAX_CONDITIONS, validateConditions } from '../src/index.js';
import { evaluateVectors, expectedDecision, rulesFor, snapshotFor, toCondition, validateVectors } from './vectors.js';

describe('vector files', () => {
  it('give every case a unique name', () => {
    for (const file of [evaluateVectors, validateVectors]) {
      const names = file.cases.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('only refer to tokens they declare', () => {
    for (const file of [evaluateVectors, validateVectors]) {
      for (const c of file.cases) {
        const conditions = 'conditions' in c ? c.conditions : c.policy.conditions;
        for (const condition of conditions) {
          if (condition.type === 'time_window') continue;
          const name = condition.type === 'token_balance' ? condition.token : condition.collection;
          expect(file.tokens, `${c.name}: ${name}`).toHaveProperty(name);
        }
      }
    }
  });

  it('have expectations that obey the decision invariants', () => {
    for (const c of evaluateVectors.cases) {
      const { allowed, reason, failedIndex } = c.expect;
      expect(reason === 'None', c.name).toBe(allowed);
      if (allowed || reason === 'Inactive') expect(failedIndex, c.name).toBeNull();
      else expect(failedIndex, c.name).toBeLessThan(c.policy.conditions.length);
      if (!allowed && reason !== 'Inactive') expect(failedIndex, c.name).not.toBeNull();
    }
  });

  it('only use as many conditions as a policy may hold when they are evaluated', () => {
    for (const c of evaluateVectors.cases) {
      expect(c.policy.conditions.length, c.name).toBeLessThanOrEqual(MAX_CONDITIONS);
    }
  });
});

describe('evaluate: shared vectors', () => {
  for (const vector of evaluateVectors.cases) {
    it(vector.name, () => {
      const rules = rulesFor(vector.policy);
      const snapshot = snapshotFor(evaluateVectors.tokens, rules.conditions, vector.subject, BigInt(vector.timestamp ?? '0'));
      expect(evaluate(rules, snapshot)).toEqual(expectedDecision(vector.expect));
    });
  }
});

describe('validate: shared vectors', () => {
  const isContract = (name: string): boolean => {
    const kind = validateVectors.tokens[name]?.kind;
    if (kind === undefined) throw new Error(`undeclared token ${name}`);
    return kind !== 'account' && kind !== 'missing';
  };

  for (const vector of validateVectors.cases) {
    it(vector.name, () => {
      const result = validateConditions(vector.conditions.map(toCondition), isContract);
      expect(result).toEqual(vector.expect);
    });
  }
});
