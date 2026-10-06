import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import {
  DENY_REASON_CODES,
  decodeNftBalance,
  decodeTokenBalance,
  denyReasonFromCode,
  evaluate,
  MissingReadingError,
  readingKey,
  validateConditions,
  type Condition,
  type Reading,
  type Snapshot,
} from '../src/index.js';

const token = (name: string, min: bigint): Condition => ({ type: 'token_balance', token: name, min });
const window = (notBefore: bigint | null, notAfter: bigint | null): Condition => ({ type: 'time_window', notBefore, notAfter });
const snapshot = (timestamp: bigint, entries: [Condition, Reading][] = []): Snapshot => ({
  timestamp,
  readings: new Map(entries.map(([c, r]) => [readingKey(c as Extract<Condition, { type: 'token_balance' }>), r])),
});

describe('decodeTokenBalance', () => {
  it('accepts an i128, including negative and very large values', () => {
    expect(decodeTokenBalance(nativeToScVal(5n, { type: 'i128' }))).toEqual({ status: 'ok', value: 5n });
    expect(decodeTokenBalance(nativeToScVal(-7n, { type: 'i128' }))).toEqual({ status: 'ok', value: -7n });
    const max = 2n ** 127n - 1n;
    expect(decodeTokenBalance(nativeToScVal(max, { type: 'i128' }))).toEqual({ status: 'ok', value: max });
  });

  it('refuses every other type, because the contract does', () => {
    for (const bad of [
      nativeToScVal(5n, { type: 'u64' }),
      nativeToScVal(5n, { type: 'i64' }),
      nativeToScVal(5n, { type: 'u128' }),
      nativeToScVal(5, { type: 'u32' }),
      nativeToScVal(5, { type: 'i32' }),
      nativeToScVal('5'),
      xdr.ScVal.scvVoid(),
      xdr.ScVal.scvBool(true),
    ]) {
      expect(decodeTokenBalance(bad)).toEqual({ status: 'unavailable' });
    }
  });

  it('treats a failed call (no return value) as unavailable', () => {
    expect(decodeTokenBalance(null)).toEqual({ status: 'unavailable' });
    expect(decodeTokenBalance(undefined)).toEqual({ status: 'unavailable' });
  });
});

describe('decodeNftBalance', () => {
  it('accepts a u32 only', () => {
    expect(decodeNftBalance(nativeToScVal(3, { type: 'u32' }))).toEqual({ status: 'ok', value: 3n });
    expect(decodeNftBalance(nativeToScVal(4294967295, { type: 'u32' }))).toEqual({ status: 'ok', value: 4294967295n });
    for (const bad of [nativeToScVal(3n, { type: 'u64' }), nativeToScVal(3n, { type: 'i128' }), nativeToScVal(3, { type: 'i32' }), null]) {
      expect(decodeNftBalance(bad)).toEqual({ status: 'unavailable' });
    }
  });
});

describe('evaluate', () => {
  it('does not need the readings of conditions after the first failure', () => {
    const early = window(1000n, null); // fails at time 0
    const later = token('gold', 1n); // would throw if it were looked at: it has no reading
    const decision = evaluate({ version: 1, active: true, conditions: [early, later] }, snapshot(0n));
    expect(decision).toEqual({ allowed: false, version: 1, failedIndex: 0, reason: 'BeforeWindow' });
  });

  it('throws when a balance condition is reached without a reading', () => {
    expect(() => evaluate({ version: 1, active: true, conditions: [token('gold', 1n)] }, snapshot(0n))).toThrow(MissingReadingError);
  });

  it('does not look at readings for an inactive policy', () => {
    const decision = evaluate({ version: 2, active: false, conditions: [token('gold', 1n)] }, snapshot(0n));
    expect(decision).toEqual({ allowed: false, version: 2, failedIndex: null, reason: 'Inactive' });
  });

  it('compares an nft minimum given as a number with a bigint balance', () => {
    const condition: Condition = { type: 'nft_balance', collection: 'badge', min: 2 };
    const at = (value: bigint) => snapshot(0n, [[condition, { status: 'ok', value }]]);
    const rules = { version: 1, active: true, conditions: [condition] };
    expect(evaluate(rules, at(1n)).reason).toBe('BelowMinimum');
    expect(evaluate(rules, at(2n)).allowed).toBe(true);
  });
});

describe('validateConditions', () => {
  it('skips the contract check when it is not told how to make it', () => {
    expect(validateConditions([token('anything', 1n)])).toEqual({ ok: true });
    expect(validateConditions([token('anything', 1n)], () => false)).toEqual({ ok: false, error: 'NotAContract' });
  });
});

describe('deny reason codes', () => {
  it('round-trip between names and the contract codes', () => {
    for (const [name, code] of Object.entries(DENY_REASON_CODES)) {
      expect(denyReasonFromCode(code)).toBe(name);
    }
    expect(() => denyReasonFromCode(6)).toThrow(RangeError);
    expect(() => denyReasonFromCode(-1)).toThrow(RangeError);
  });
});
