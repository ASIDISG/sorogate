import { Address, nativeToScVal, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import { DecodeError, decodeDecision, decodePolicy, encodeCondition, encodeConditions, type Condition } from '../src/index.js';
import { accountId, contractId, decisionScVal, structOf } from './helpers.js';

const sym = (s: string) => xdr.ScVal.scvSymbol(s);

const token = contractId(1);
const collection = contractId(2);

describe('encodeCondition', () => {
  it('writes the shapes the contract expects: unions as [Symbol, struct], struct keys in order, None as void', () => {
    const conditions: Condition[] = [
      { type: 'token_balance', token, min: 100n },
      { type: 'nft_balance', collection, min: 2 },
      { type: 'time_window', notBefore: 5n, notAfter: null },
    ];
    expect(scValToNative(encodeConditions(conditions))).toEqual([
      ['TokenBalance', { min: 100n, token }],
      ['NftBalance', { collection, min: 2 }],
      ['TimeWindow', { not_after: null, not_before: 5n }],
    ]);
  });

  it('orders struct keys alphabetically, which Soroban requires', () => {
    // Decoding a map keeps the order of its entries, so the key order read back is the order that was written.
    const window = scValToNative(encodeCondition({ type: 'time_window', notBefore: 1n, notAfter: 2n })) as [string, Record<string, unknown>];
    expect(Object.keys(window[1])).toEqual(['not_after', 'not_before']);
    const balance = scValToNative(encodeCondition({ type: 'token_balance', token, min: 1n })) as [string, Record<string, unknown>];
    expect(Object.keys(balance[1])).toEqual(['min', 'token']);
    const nft = scValToNative(encodeCondition({ type: 'nft_balance', collection, min: 1 })) as [string, Record<string, unknown>];
    expect(Object.keys(nft[1])).toEqual(['collection', 'min']);
  });

  it('keeps the largest values exact', () => {
    const max = 2n ** 127n - 1n;
    const native = scValToNative(encodeCondition({ type: 'token_balance', token, min: max })) as [string, { min: bigint }];
    expect(native[1].min).toBe(max);
    const window = scValToNative(encodeCondition({ type: 'time_window', notBefore: 2n ** 64n - 2n, notAfter: 2n ** 64n - 1n })) as [string, { not_before: bigint; not_after: bigint }];
    expect(window[1].not_after).toBe(2n ** 64n - 1n);
  });
});

describe('decodeDecision', () => {
  it('decodes an allowed decision', () => {
    expect(decodeDecision(decisionScVal({ allowed: true, version: 3, failedIndex: null, reason: 0 }))).toEqual({
      allowed: true,
      version: 3,
      failedIndex: null,
      reason: 'None',
    });
  });

  it('decodes a denial with its index and reason name', () => {
    expect(decodeDecision(decisionScVal({ allowed: false, version: 1, failedIndex: 4, reason: 3 }))).toEqual({
      allowed: false,
      version: 1,
      failedIndex: 4,
      reason: 'BalanceUnavailable',
    });
  });

  it('refuses a decision that breaks the contract invariant, an unknown reason, or the wrong shape', () => {
    expect(() => decodeDecision(decisionScVal({ allowed: true, version: 1, failedIndex: null, reason: 2 }))).toThrow(DecodeError);
    expect(() => decodeDecision(decisionScVal({ allowed: false, version: 1, failedIndex: 0, reason: 9 }))).toThrow(DecodeError);
    expect(() => decodeDecision(nativeToScVal(7, { type: 'u32' }))).toThrow(DecodeError);
    expect(() => decodeDecision(structOf({ allowed: xdr.ScVal.scvBool(true) }))).toThrow(DecodeError);
  });
});

describe('decodePolicy', () => {
  const policyScVal = (conditions: Condition[], extra: Partial<Record<string, xdr.ScVal>> = {}): xdr.ScVal =>
    structOf({
      active: xdr.ScVal.scvBool(true),
      conditions: encodeConditions(conditions),
      owner: new Address(accountId()).toScVal(),
      version: nativeToScVal(2, { type: 'u32' }),
      ...extra,
    });

  it('round-trips every kind of condition', () => {
    const conditions: Condition[] = [
      { type: 'token_balance', token, min: 7n },
      { type: 'nft_balance', collection, min: 1 },
      { type: 'time_window', notBefore: null, notAfter: 99n },
      { type: 'time_window', notBefore: 1n, notAfter: null },
    ];
    const policy = decodePolicy(policyScVal(conditions));
    expect(policy.conditions).toEqual(conditions);
    expect(policy.version).toBe(2);
    expect(policy.active).toBe(true);
    expect(StrKey.isValidEd25519PublicKey(policy.owner)).toBe(true);
  });

  it('refuses unknown condition kinds and malformed fields', () => {
    const unknown = xdr.ScVal.scvVec([xdr.ScVal.scvVec([sym('Mystery'), structOf({})])]);
    expect(() => decodePolicy(policyScVal([], { conditions: unknown }))).toThrow(DecodeError);
    expect(() => decodePolicy(policyScVal([], { active: nativeToScVal(1, { type: 'u32' }) }))).toThrow(DecodeError);
    expect(() => decodePolicy(policyScVal([], { version: nativeToScVal(-1n, { type: 'i128' }) }))).toThrow(DecodeError);
  });
});
