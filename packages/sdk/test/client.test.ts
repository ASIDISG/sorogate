import { Account, Address, nativeToScVal, scValToNative, type xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import {
  ContractCallError,
  evaluate,
  evaluateOnChain,
  fetchSnapshot,
  getPolicy,
  LedgerMovedError,
  parseContractError,
  readBalance,
  SimulationError,
  type CallContext,
  type Condition,
} from '../src/index.js';
import { accountId, contractId, decisionScVal, policyScVal } from './helpers.js';

const PASSPHRASE = 'Test SDF Network ; September 2015';
const source = accountId();
const subject = accountId();
const policyContract = contractId(9);
const tokenA = contractId(1);
const collectionB = contractId(2);

interface Call {
  contract: string;
  method: string;
  args: xdr.ScVal[];
}
type Reply = { retval: xdr.ScVal } | { error: string };

/**
 * A stand-in for the RPC server. `reply` answers each simulated call, and `ledgers` is the ledger number reported
 * by each successive RPC call (getLatestLedger or a simulation); the last value repeats. A test can therefore make
 * the network move on between two reads.
 */
function fakeRpc(reply: (call: Call) => Reply, options: { ledgers?: number[]; closeTime?: string } = {}) {
  const ledgers = options.ledgers ?? [100];
  const calls: Call[] = [];
  let step = 0;
  let latestLedgerCalls = 0;
  const nextLedger = (): number => ledgers[Math.min(step++, ledgers.length - 1)] as number;
  const server = {
    async getAccount(): Promise<Account> {
      return new Account(source, '0');
    },
    async getLatestLedger() {
      latestLedgerCalls++;
      return { id: 'id', sequence: nextLedger(), protocolVersion: 29, closeTime: options.closeTime ?? '1700000000', headerXdr: '', metadataXdr: '' };
    },
    async simulateTransaction(tx: { operations: { func: { invokeContract: { contractAddress: Parameters<typeof Address.fromScAddress>[0]; functionName: unknown; args: xdr.ScVal[] } } }[] }) {
      const invoke = tx.operations[0]?.func.invokeContract;
      if (invoke === undefined) throw new Error('not an invocation');
      const call: Call = {
        contract: Address.fromScAddress(invoke.contractAddress).toString(),
        method: JSON.parse(JSON.stringify(invoke.functionName)) as string,
        args: invoke.args,
      };
      calls.push(call);
      const latestLedger = nextLedger();
      const answer = reply(call);
      return 'error' in answer ? { latestLedger, error: answer.error } : { latestLedger, result: { retval: answer.retval } };
    },
  };
  const context: CallContext = { rpc: server as unknown as CallContext['rpc'], networkPassphrase: PASSPHRASE, source };
  return { context, calls, latestLedgerCalls: () => latestLedgerCalls };
}

const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' });
const failure = (text: string): Reply => ({ error: text });

describe('parseContractError', () => {
  it('recognises the contract\'s own errors by code', () => {
    expect(parseContractError('HostError: Error(Contract, #1)\n\nEvent log')).toMatchObject({ errorName: 'PolicyNotFound', code: 1 });
    expect(parseContractError('Error(Contract, #6)')).toMatchObject({ errorName: 'NotAContract', code: 6 });
  });

  it('does not mistake other failures for them', () => {
    expect(parseContractError('HostError: Error(Budget, ExceededLimit)')).toBeNull();
    expect(parseContractError('HostError: Error(Contract, #99)')).toBeNull();
    expect(parseContractError('something else')).toBeNull();
  });
});

describe('evaluateOnChain', () => {
  it('asks the contract for evaluate(policy id, subject) and decodes the decision and the ledger', async () => {
    const { context, calls } = fakeRpc(() => ({ retval: decisionScVal({ allowed: false, version: 2, failedIndex: 1, reason: 2 }) }), { ledgers: [321] });
    const result = await evaluateOnChain(context, { contractId: policyContract, policyId: 5n, subject });

    expect(result).toEqual({ decision: { allowed: false, version: 2, failedIndex: 1, reason: 'BelowMinimum' }, ledgerSequence: 321 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.contract).toBe(policyContract);
    expect(calls[0]?.method).toBe('evaluate');
    expect(calls[0]?.args.map((a) => a.type)).toEqual(['scvU64', 'scvAddress']);
    expect(scValToNative(calls[0]?.args[0] as xdr.ScVal)).toBe(5n);
    expect(scValToNative(calls[0]?.args[1] as xdr.ScVal)).toBe(subject);
  });

  it('turns the contract\'s own errors into ContractCallError and any other failure into SimulationError', async () => {
    const missing = fakeRpc(() => failure('HostError: Error(Contract, #1)\n\nEvent log (newest first)'));
    await expect(evaluateOnChain(missing.context, { contractId: policyContract, policyId: 9, subject })).rejects.toBeInstanceOf(ContractCallError);
    await expect(evaluateOnChain(missing.context, { contractId: policyContract, policyId: 9, subject })).rejects.toMatchObject({ errorName: 'PolicyNotFound' });

    const budget = fakeRpc(() => failure('HostError: Error(Budget, ExceededLimit)'));
    await expect(evaluateOnChain(budget.context, { contractId: policyContract, policyId: 1, subject })).rejects.toBeInstanceOf(SimulationError);
  });
});

describe('getPolicy', () => {
  it('asks for get(policy id) and decodes the stored policy', async () => {
    const conditions: Condition[] = [{ type: 'token_balance', token: tokenA, min: 10n }];
    const owner = accountId();
    const { context, calls } = fakeRpc(() => ({ retval: policyScVal(conditions, { owner, version: 3 }) }));
    const { policy } = await getPolicy(context, { contractId: policyContract, policyId: 2 });

    expect(policy).toEqual({ owner, version: 3, active: true, conditions });
    expect(calls[0]).toMatchObject({ contract: policyContract, method: 'get' });
  });
});

describe('readBalance', () => {
  it('reads balance(subject) of a token as an i128', async () => {
    const { context, calls } = fakeRpc(() => ({ retval: i128(250n) }));
    const { reading } = await readBalance(context, { kind: 'token', address: tokenA, subject });
    expect(reading).toEqual({ status: 'ok', value: 250n });
    expect(calls[0]).toMatchObject({ contract: tokenA, method: 'balance' });
    expect(scValToNative(calls[0]?.args[0] as xdr.ScVal)).toBe(subject);
  });

  it('reads a collection as a u32', async () => {
    const { context } = fakeRpc(() => ({ retval: u32(3) }));
    expect((await readBalance(context, { kind: 'nft', address: collectionB, subject })).reading).toEqual({ status: 'ok', value: 3n });
  });

  it('reports unavailable when the call fails or returns the wrong type', async () => {
    const failing = fakeRpc(() => failure('HostError: Error(Contract, #13)\n"trustline entry is missing"'));
    expect((await readBalance(failing.context, { kind: 'token', address: tokenA, subject })).reading).toEqual({ status: 'unavailable' });

    const wide = fakeRpc(() => ({ retval: nativeToScVal(5n, { type: 'u64' }) }));
    expect((await readBalance(wide.context, { kind: 'token', address: tokenA, subject })).reading).toEqual({ status: 'unavailable' });
    expect((await readBalance(wide.context, { kind: 'nft', address: collectionB, subject })).reading).toEqual({ status: 'unavailable' });
  });
});

describe('fetchSnapshot', () => {
  const conditions: Condition[] = [
    { type: 'token_balance', token: tokenA, min: 100n },
    { type: 'nft_balance', collection: collectionB, min: 1 },
    { type: 'time_window', notBefore: 0n, notAfter: null },
  ];
  const balances = (call: Call): Reply => (call.contract === tokenA ? { retval: i128(150n) } : { retval: u32(2) });

  it('reads the time and every balance from one ledger, and the model can evaluate it', async () => {
    const { context, calls } = fakeRpc(balances, { ledgers: [100], closeTime: '1700000123' });
    const { snapshot, ledgerSequence } = await fetchSnapshot(context, { conditions, subject });

    expect(ledgerSequence).toBe(100);
    expect(snapshot.timestamp).toBe(1700000123n);
    expect(calls.map((c) => c.contract)).toEqual([tokenA, collectionB]); // the time window needs no call
    expect(evaluate({ version: 1, active: true, conditions }, snapshot)).toEqual({ allowed: true, version: 1, failedIndex: null, reason: 'None' });
  });

  it('reads again when the ledger moves while it is reading, and reports the ledger it finally used', async () => {
    // getLatestLedger -> 100, first balance -> 101 (moved: start over), getLatestLedger -> 101, balances -> 101
    const { context, latestLedgerCalls } = fakeRpc(balances, { ledgers: [100, 101] });
    const { ledgerSequence } = await fetchSnapshot(context, { conditions, subject });
    expect(ledgerSequence).toBe(101);
    expect(latestLedgerCalls()).toBe(2);
  });

  it('gives up with LedgerMovedError when the ledger never holds still', async () => {
    const { context } = fakeRpc(balances, { ledgers: Array.from({ length: 50 }, (_, i) => 100 + i) });
    await expect(fetchSnapshot(context, { conditions, subject, attempts: 3 })).rejects.toBeInstanceOf(LedgerMovedError);
  });

  it('reads a token once however many conditions name it', async () => {
    const twice: Condition[] = [
      { type: 'token_balance', token: tokenA, min: 1n },
      { type: 'token_balance', token: tokenA, min: 2n },
    ];
    const { context, calls } = fakeRpc(balances);
    await fetchSnapshot(context, { conditions: twice, subject });
    expect(calls).toHaveLength(1);
  });

  it('makes no balance calls for a policy of time windows only', async () => {
    const { context, calls } = fakeRpc(balances, { closeTime: '5' });
    const { snapshot } = await fetchSnapshot(context, { conditions: [{ type: 'time_window', notBefore: 1n, notAfter: 9n }], subject });
    expect(calls).toHaveLength(0);
    expect(snapshot.timestamp).toBe(5n);
  });

  it('records an unavailable balance as such, so the model reports BalanceUnavailable', async () => {
    const { context } = fakeRpc(() => failure('HostError: Error(Contract, #13)'));
    const { snapshot } = await fetchSnapshot(context, { conditions: [conditions[0] as Condition], subject });
    expect(evaluate({ version: 1, active: true, conditions: [conditions[0] as Condition] }, snapshot)).toMatchObject({ allowed: false, reason: 'BalanceUnavailable', failedIndex: 0 });
  });
});
