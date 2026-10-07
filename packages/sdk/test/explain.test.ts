import { describe, expect, it } from 'vitest';

import { describeCondition, explainDecision, formatUnixSeconds, shortAddress, type Condition, type Decision } from '../src/index.js';
import { contractId } from './helpers.js';

const token = contractId(1);
const collection = contractId(2);

const denied = (reason: Decision['reason'], failedIndex: number | null, version = 1): Decision => ({ allowed: false, version, failedIndex, reason });

describe('shortAddress and formatUnixSeconds', () => {
  it('keep the start and end of an address and leave short text alone', () => {
    expect(shortAddress(token)).toMatch(/^C[A-Z2-7]{4}…[A-Z2-7]{4}$/);
    expect(shortAddress('GABC')).toBe('GABC');
  });

  it('write unix seconds as a UTC date, and fall back to the raw number beyond any calendar date', () => {
    expect(formatUnixSeconds(0n)).toBe('1970-01-01 00:00:00 UTC');
    expect(formatUnixSeconds(1_791_302_172n)).toBe('2026-10-06 15:56:12 UTC');
    expect(formatUnixSeconds(253_402_300_799n)).toBe('9999-12-31 23:59:59 UTC');
    expect(formatUnixSeconds(253_402_300_800n)).toBe('253402300800 (unix seconds)');
    expect(formatUnixSeconds(2n ** 64n - 1n)).toBe('18446744073709551615 (unix seconds)');
  });
});

describe('describeCondition', () => {
  it('describes a token condition in base units, or in display units when the decimals are known', () => {
    const c: Condition = { type: 'token_balance', token, min: 1_500_000_000n };
    expect(describeCondition(c)).toBe(`holds at least 1500000000 (in the token's smallest unit) of token ${shortAddress(token)}`);
    expect(describeCondition(c, { decimals: { [token]: 7 } })).toBe(`holds at least 150 of token ${shortAddress(token)}`);
  });

  it('describes a collection condition', () => {
    expect(describeCondition({ type: 'nft_balance', collection, min: 2 })).toBe(`holds at least 2 of collection ${shortAddress(collection)}`);
  });

  it('describes all three shapes of time window', () => {
    expect(describeCondition({ type: 'time_window', notBefore: 0n, notAfter: 86_400n })).toBe(
      'the ledger time is from 1970-01-01 00:00:00 UTC until 1970-01-02 00:00:00 UTC',
    );
    expect(describeCondition({ type: 'time_window', notBefore: 86_400n, notAfter: null })).toBe('the ledger time is 1970-01-02 00:00:00 UTC or later');
    expect(describeCondition({ type: 'time_window', notBefore: null, notAfter: 86_400n })).toBe('the ledger time is before 1970-01-02 00:00:00 UTC');
  });
});

describe('explainDecision', () => {
  const conditions: Condition[] = [
    { type: 'time_window', notBefore: 0n, notAfter: null },
    { type: 'token_balance', token, min: 100n },
  ];

  it('says allowed, with the version', () => {
    expect(explainDecision({ allowed: true, version: 3, failedIndex: null, reason: 'None' })).toBe('Allowed: every condition holds (policy version 3).');
  });

  it('says an inactive policy was deactivated by its owner', () => {
    expect(explainDecision(denied('Inactive', null, 2))).toBe('Denied: the owner of this policy has deactivated it (policy version 2).');
  });

  it('names the failed condition, counting from one, and how many there are', () => {
    const text = explainDecision(denied('BelowMinimum', 1), conditions);
    expect(text).toContain('condition 2 of 2');
    expect(text).toContain(`holds at least 100 (in the token's smallest unit) of token ${shortAddress(token)}`);
    expect(text).toContain('policy version 1');
  });

  it('still says which condition number failed when it is not given the conditions', () => {
    const text = explainDecision(denied('BelowMinimum', 0));
    expect(text).toContain('condition 1');
    expect(text).not.toContain(' of ');
  });

  it('explains an unavailable balance without calling it an outage', () => {
    const text = explainDecision(denied('BalanceUnavailable', 1), conditions);
    expect(text).toContain('trustline');
    expect(text).toContain('could not be checked');
  });

  it('distinguishes too early from too late', () => {
    expect(explainDecision(denied('BeforeWindow', 0), conditions)).toContain('too early');
    expect(explainDecision(denied('AfterWindow', 0), conditions)).toContain('too late');
  });

  it('never prints a placeholder for a missing piece', () => {
    for (const reason of ['Inactive', 'BelowMinimum', 'BalanceUnavailable', 'BeforeWindow', 'AfterWindow'] as const) {
      for (const text of [explainDecision(denied(reason, null)), explainDecision(denied(reason, 0)), explainDecision(denied(reason, 5), conditions)]) {
        expect(text, reason).not.toMatch(/undefined|null|NaN|\[object/);
        expect(text.length, reason).toBeGreaterThan(20);
      }
    }
  });
});
