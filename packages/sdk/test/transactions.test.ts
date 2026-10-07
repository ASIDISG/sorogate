import { Account, Address, Keypair, nativeToScVal, scValToNative, TransactionBuilder, type Transaction, type xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import { ContractCallError, SimulationError } from '../src/client.js';
import { encodeConditions } from '../src/scval.js';
import {
  InvalidPolicyError,
  prepareCreatePolicy,
  prepareSetActive,
  prepareUpdatePolicy,
  submitSigned,
  SubmissionError,
  TransactionFailedError,
  TransactionTimeoutError,
  type WriteContext,
} from '../src/transactions.js';
import type { Condition } from '../src/types.js';
import { contractId } from './helpers.js';

const PASSPHRASE = 'Test SDF Network ; September 2015';
const policyContract = contractId(9);
const token = contractId(1);
const conditions: Condition[] = [
  { type: 'token_balance', token, min: 100n },
  { type: 'time_window', notBefore: 5n, notAfter: null },
];

interface Invocation {
  contract: string;
  method: string;
  args: xdr.ScVal[];
}

const invocationOf = (tx: Transaction): Invocation => {
  const invoke = (tx.operations[0] as unknown as { func: { invokeContract: { contractAddress: Parameters<typeof Address.fromScAddress>[0]; functionName: unknown; args: xdr.ScVal[] } } }).func.invokeContract;
  return { contract: Address.fromScAddress(invoke.contractAddress).toString(), method: JSON.parse(JSON.stringify(invoke.functionName)) as string, args: invoke.args };
};

type Status = { status: 'NOT_FOUND' } | { status: 'FAILED' } | { status: 'SUCCESS'; ledger: number; returnValue?: xdr.ScVal };

/** A stand-in RPC server. `statuses` is what getTransaction answers, one per call (the last repeats). */
function fakeWriteRpc(
  options: { prepareFails?: Error; sendStatus?: string; statuses?: Status[]; prepareChanges?: (tx: Transaction) => Transaction } = {},
) {
  const counts = { getAccount: 0, prepare: 0, send: 0, get: 0 };
  const statuses = options.statuses ?? [{ status: 'SUCCESS', ledger: 100 }];
  const server = {
    async getAccount(source: string) {
      counts.getAccount++;
      return new Account(source, '7');
    },
    async prepareTransaction(tx: Transaction) {
      counts.prepare++;
      if (options.prepareFails) throw options.prepareFails;
      return options.prepareChanges ? options.prepareChanges(tx) : tx;
    },
    async sendTransaction(tx: Transaction) {
      counts.send++;
      return { status: options.sendStatus ?? 'PENDING', hash: Buffer.from(tx.hash()).toString('hex'), errorResult: options.sendStatus === 'ERROR' ? { code: 'txBadAuth' } : undefined };
    },
    async getTransaction() {
      const answer = statuses[Math.min(counts.get++, statuses.length - 1)] as Status;
      return answer;
    },
  };
  const context: WriteContext = { rpc: server as unknown as WriteContext['rpc'], networkPassphrase: PASSPHRASE };
  return { context, counts };
}

describe('prepareCreatePolicy', () => {
  it('builds an unsigned create(owner, conditions) whose source is the owner', async () => {
    const owner = Keypair.random().publicKey();
    const { context } = fakeWriteRpc();
    const prepared = await prepareCreatePolicy(context, { contractId: policyContract, owner, conditions });

    expect(prepared.transaction.source).toBe(owner);
    expect(prepared.transaction.signatures).toHaveLength(0);
    const call = invocationOf(prepared.transaction);
    expect(call.contract).toBe(policyContract);
    expect(call.method).toBe('create');
    expect(call.args.map((a) => a.type)).toEqual(['scvAddress', 'scvVec']);
    expect(scValToNative(call.args[0] as xdr.ScVal)).toBe(owner);
    expect(scValToNative(call.args[1] as xdr.ScVal)).toEqual(scValToNative(encodeConditions(conditions)));
  });

  it('returns the transaction as XDR that parses back to the same transaction', async () => {
    const { context } = fakeWriteRpc();
    const prepared = await prepareCreatePolicy(context, { contractId: policyContract, owner: Keypair.random().publicKey(), conditions });
    const parsed = TransactionBuilder.fromXDR(prepared.xdr, PASSPHRASE);
    expect(parsed.toXDR()).toBe(prepared.xdr);
  });

  it('returns the transaction the network prepared, not the one that was built before simulating', async () => {
    const owner = Keypair.random().publicKey();
    const { context } = fakeWriteRpc({
      prepareChanges: (tx) => TransactionBuilder.cloneFrom(tx, { fee: '777', networkPassphrase: PASSPHRASE }).build(),
    });
    const prepared = await prepareCreatePolicy(context, { contractId: policyContract, owner, conditions });
    expect(prepared.transaction.fee).toBe('777');
    expect(TransactionBuilder.fromXDR(prepared.xdr, PASSPHRASE).toXDR()).toBe(prepared.transaction.toXDR());
  });

  it('bids the network minimum fee and gives a person five minutes to sign, unless told otherwise', async () => {
    const { context } = fakeWriteRpc();
    const now = Math.floor(Date.now() / 1000);
    const byDefault = await prepareCreatePolicy(context, { contractId: policyContract, owner: Keypair.random().publicKey(), conditions });
    expect(byDefault.transaction.fee).toBe('100');
    const maxTime = Number(byDefault.transaction.timeBounds?.maxTime);
    expect(maxTime).toBeGreaterThanOrEqual(now + 295);
    expect(maxTime).toBeLessThanOrEqual(now + 310);

    const custom = await prepareCreatePolicy(context, { contractId: policyContract, owner: Keypair.random().publicKey(), conditions, fee: '500', timeoutSeconds: 60 });
    expect(custom.transaction.fee).toBe('500');
    expect(Number(custom.transaction.timeBounds?.maxTime)).toBeLessThanOrEqual(now + 70);
  });

  it('refuses a policy the contract would refuse, before it talks to the network at all', async () => {
    const { context, counts } = fakeWriteRpc();
    const owner = Keypair.random().publicKey();
    const bad: Condition[][] = [[], [{ type: 'token_balance', token, min: 0n }], [{ type: 'time_window', notBefore: null, notAfter: null }]];
    const names = ['NoConditions', 'InvalidMinimum', 'InvalidTimeWindow'];
    for (const [i, list] of bad.entries()) {
      const error = await prepareCreatePolicy(context, { contractId: policyContract, owner, conditions: list }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidPolicyError);
      expect((error as InvalidPolicyError).errorName).toBe(names[i]);
    }
    expect(counts).toEqual({ getAccount: 0, prepare: 0, send: 0, get: 0 });
  });

  it("turns the contract's own refusal during simulation into ContractCallError, and any other failure into SimulationError", async () => {
    const owner = Keypair.random().publicKey();
    const refused = fakeWriteRpc({ prepareFails: new Error('HostError: Error(Contract, #6)\nEvent log') });
    const error = await prepareCreatePolicy(refused.context, { contractId: policyContract, owner, conditions }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContractCallError);
    expect(error).toMatchObject({ errorName: 'NotAContract', code: 6 });

    const broken = fakeWriteRpc({ prepareFails: new Error('connection reset') });
    await expect(prepareCreatePolicy(broken.context, { contractId: policyContract, owner, conditions })).rejects.toBeInstanceOf(SimulationError);
  });
});

describe('prepareUpdatePolicy and prepareSetActive', () => {
  it('builds update(policy id, conditions)', async () => {
    const owner = Keypair.random().publicKey();
    const { context } = fakeWriteRpc();
    const prepared = await prepareUpdatePolicy(context, { contractId: policyContract, owner, policyId: 7n, conditions });
    const call = invocationOf(prepared.transaction);
    expect(call.method).toBe('update');
    expect(call.args.map((a) => a.type)).toEqual(['scvU64', 'scvVec']);
    expect(scValToNative(call.args[0] as xdr.ScVal)).toBe(7n);
    expect(prepared.transaction.source).toBe(owner);
  });

  it('checks the new conditions of an update too', async () => {
    const { context, counts } = fakeWriteRpc();
    await expect(prepareUpdatePolicy(context, { contractId: policyContract, owner: Keypair.random().publicKey(), policyId: 1, conditions: [] })).rejects.toBeInstanceOf(InvalidPolicyError);
    expect(counts.getAccount).toBe(0);
  });

  it('builds set_active(policy id, flag) for both values', async () => {
    const { context } = fakeWriteRpc();
    const owner = Keypair.random().publicKey();
    for (const active of [true, false]) {
      const prepared = await prepareSetActive(context, { contractId: policyContract, owner, policyId: 3, active });
      const call = invocationOf(prepared.transaction);
      expect(call.method).toBe('set_active');
      expect(call.args.map((a) => a.type)).toEqual(['scvU64', 'scvBool']);
      expect(scValToNative(call.args[0] as xdr.ScVal)).toBe(3n);
      expect(scValToNative(call.args[1] as xdr.ScVal)).toBe(active);
    }
  });
});

describe('submitSigned', () => {
  const signedXdr = async (): Promise<string> => {
    const owner = Keypair.random();
    const { context } = fakeWriteRpc();
    const prepared = await prepareCreatePolicy(context, { contractId: policyContract, owner: owner.publicKey(), conditions });
    prepared.transaction.sign(owner);
    return prepared.transaction.toXDR();
  };

  it('sends the transaction, waits until it is applied, and returns the hash, the ledger and the return value', async () => {
    const returned = nativeToScVal(12n, { type: 'u64' });
    const { context, counts } = fakeWriteRpc({ statuses: [{ status: 'NOT_FOUND' }, { status: 'NOT_FOUND' }, { status: 'SUCCESS', ledger: 321, returnValue: returned }] });
    const result = await submitSigned(context, await signedXdr(), { pollMs: 1, timeoutMs: 2000 });

    expect(result.ledger).toBe(321);
    expect(scValToNative(result.returnValue as xdr.ScVal)).toBe(12n);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(counts.send).toBe(1);
    expect(counts.get).toBe(3);
  });

  it('reports the hash of the transaction on this network, which depends on the network passphrase', async () => {
    const xdrText = await signedXdr();
    const { context } = fakeWriteRpc();
    const result = await submitSigned(context, xdrText, { pollMs: 1, timeoutMs: 2000 });
    const expected = Buffer.from(TransactionBuilder.fromXDR(xdrText, PASSPHRASE).hash()).toString('hex');
    expect(result.hash).toBe(expected);
    const otherNetwork = Buffer.from(TransactionBuilder.fromXDR(xdrText, 'Public Global Stellar Network ; September 2015').hash()).toString('hex');
    expect(result.hash).not.toBe(otherNetwork);
  });

  it('refuses a fee-bump transaction', async () => {
    const owner = Keypair.random();
    const { context, counts } = fakeWriteRpc();
    const prepared = await prepareCreatePolicy(context, { contractId: policyContract, owner: owner.publicKey(), conditions });
    prepared.transaction.sign(owner);
    const sponsor = Keypair.random();
    const bumped = TransactionBuilder.buildFeeBumpTransaction(sponsor, '200', prepared.transaction, PASSPHRASE);
    bumped.sign(sponsor);
    await expect(submitSigned(context, bumped.toXDR())).rejects.toBeInstanceOf(SubmissionError);
    expect(counts.send).toBe(0);
  });

  it('reports a transaction the network refuses outright, or is too busy for', async () => {
    const refused = fakeWriteRpc({ sendStatus: 'ERROR' });
    await expect(submitSigned(refused.context, await signedXdr())).rejects.toBeInstanceOf(SubmissionError);
    expect(refused.counts.get).toBe(0);
    const busy = fakeWriteRpc({ sendStatus: 'TRY_AGAIN_LATER' });
    await expect(submitSigned(busy.context, await signedXdr())).rejects.toBeInstanceOf(SubmissionError);
  });

  it('reports a transaction that ran and failed, with its hash', async () => {
    const { context } = fakeWriteRpc({ statuses: [{ status: 'NOT_FOUND' }, { status: 'FAILED' }] });
    const error = await submitSigned(context, await signedXdr(), { pollMs: 1, timeoutMs: 2000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionFailedError);
    expect((error as TransactionFailedError).hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives up with a timeout, saying the transaction may still be applied', async () => {
    const { context } = fakeWriteRpc({ statuses: [{ status: 'NOT_FOUND' }] });
    const error = await submitSigned(context, await signedXdr(), { pollMs: 5, timeoutMs: 40 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionTimeoutError);
    expect((error as Error).message).toContain('may still be applied');
  });
});
