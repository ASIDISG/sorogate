/**
 * The codec against real output of the deployed contract, recorded from Testnet (see the provenance block in
 * `fixtures/testnet-recordings.json`). Nothing here talks to the network.
 */
import { readFileSync } from 'node:fs';

import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import { decodeDecision, decodePolicy, encodeConditions, MAX_CONDITIONS } from '../src/index.js';

interface Recordings {
  provenance: { label: string; contractId: string; wasmSha256: string; recordedAt: string };
  policies: { id: number; get: string; evaluate: { subject: string; xdr: string }[] }[];
}

const recordings = JSON.parse(readFileSync(new URL('./fixtures/testnet-recordings.json', import.meta.url), 'utf8')) as Recordings;
const scVal = (base64: string): xdr.ScVal => xdr.ScVal.fromXDR(base64, 'base64');

describe('recordings from the deployed contract', () => {
  it('carry their provenance', () => {
    expect(recordings.provenance.label).toBe('Recorded');
    expect(recordings.provenance.contractId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(recordings.provenance.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recordings.policies.length).toBeGreaterThanOrEqual(10);
  });

  it('decode as policies with between one and the maximum number of conditions', () => {
    for (const { id, get } of recordings.policies) {
      const policy = decodePolicy(scVal(get));
      expect(policy.conditions.length, `policy ${id}`).toBeGreaterThanOrEqual(1);
      expect(policy.conditions.length, `policy ${id}`).toBeLessThanOrEqual(MAX_CONDITIONS);
      expect(policy.version, `policy ${id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('are reproduced exactly by encoding the decoded conditions again', () => {
    for (const { id, get } of recordings.policies) {
      const recorded = scVal(get);
      const policy = decodePolicy(recorded);
      const recordedConditions = (scValToNative(recorded) as { conditions: unknown }).conditions;
      expect(scValToNative(encodeConditions(policy.conditions)), `policy ${id}`).toEqual(recordedConditions);
    }
  });

  it('decode as decisions that obey the contract\'s invariants and name the stored version', () => {
    for (const { id, get, evaluate } of recordings.policies) {
      const policy = decodePolicy(scVal(get));
      expect(evaluate.length).toBeGreaterThan(0);
      for (const { subject, xdr: recorded } of evaluate) {
        const decision = decodeDecision(scVal(recorded));
        const where = `policy ${id}, ${subject}`;
        expect(decision.version, where).toBe(policy.version);
        expect(decision.reason === 'None', where).toBe(decision.allowed);
        if (decision.failedIndex !== null) expect(decision.failedIndex, where).toBeLessThan(policy.conditions.length);
      }
    }
  });

  it('show the real behaviour of an asset contract for an account that has no trustline', () => {
    // Policy 1 asks for a huge balance of a Stellar asset contract. The issuer holds the largest balance
    // possible for it but still less than that; an account with no trustline makes the asset contract raise an
    // error, which the policy contract reports as BalanceUnavailable; a contract address simply has no balance.
    const policy1 = recordings.policies.find((p) => p.id === 1);
    expect(policy1).toBeDefined();
    const byLabel = Object.fromEntries((policy1?.evaluate ?? []).map((e) => [e.subject, decodeDecision(scVal(e.xdr))]));
    expect(byLabel.issuer).toMatchObject({ allowed: false, failedIndex: 0, reason: 'BelowMinimum', version: 2 });
    expect(byLabel['account with no trustline']).toMatchObject({ allowed: false, failedIndex: 0, reason: 'BalanceUnavailable', version: 2 });
    expect(byLabel['contract address with no balance']).toMatchObject({ allowed: false, failedIndex: 0, reason: 'BelowMinimum', version: 2 });
  });
});
