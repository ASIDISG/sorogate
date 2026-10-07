/**
 * Reading from a deployed contract through a Soroban RPC server. Everything here is a simulation: nothing is
 * signed or submitted, and the `source` account only has to exist.
 *
 * Two answers are available for "does this address satisfy this policy?":
 *  - `evaluateOnChain` asks the contract. It is the authoritative answer.
 *  - `fetchSnapshot` plus `evaluate` asks the tokens for balances and works the answer out locally. It is a
 *    model, useful for previews and explanations, and it is tested against the contract.
 */
import { Account, Contract, TransactionBuilder, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';

import { decodeNftBalance, decodeTokenBalance } from './decode.js';
import { addressToScVal, DecodeError, decodeDecision, decodePolicy, u64ToScVal } from './scval.js';
import {
  CONTRACT_ERROR_CODES,
  readingKey,
  type Condition,
  type ContractErrorName,
  type Decision,
  type Policy,
  type Reading,
  type Snapshot,
} from './types.js';

/** The part of `rpc.Server` this package uses, so tests can supply a stand-in. */
export type RpcLike = Pick<rpc.Server, 'getAccount' | 'simulateTransaction' | 'getLatestLedger'>;

export interface CallContext {
  rpc: RpcLike;
  networkPassphrase: string;
  /** Any account that exists on the network. It is only used as the source of the simulated transaction. */
  source: string;
}

/** The contract raised one of its own errors, for example `PolicyNotFound`. */
export class ContractCallError extends Error {
  constructor(
    public readonly errorName: ContractErrorName,
    public readonly code: number,
  ) {
    super(`The contract returned ${errorName} (error ${code})`);
    this.name = 'ContractCallError';
  }
}

/** The simulation failed for a reason other than one of the contract's own errors. */
export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationError';
  }
}

/** Every read of one snapshot must come from the same ledger; the network kept moving on too many attempts. */
export class LedgerMovedError extends Error {
  constructor(attempts: number) {
    super(`The ledger changed during all ${attempts} attempts to read one consistent snapshot`);
    this.name = 'LedgerMovedError';
  }
}

const errorNameByCode = new Map<number, ContractErrorName>(
  Object.entries(CONTRACT_ERROR_CODES).map(([name, code]) => [code, name as ContractErrorName]),
);

/** Finds the contract's own error in the text of a failed simulation, if it is one. */
export function parseContractError(message: string): ContractCallError | null {
  const match = /Error\(Contract, #(\d+)\)/.exec(message);
  if (match === null) return null;
  const code = Number(match[1]);
  const name = errorNameByCode.get(code);
  return name === undefined ? null : new ContractCallError(name, code);
}

interface Simulated {
  /** The return value, or `null` when the simulation failed. */
  returnValue: xdr.ScVal | null;
  /** The failure text when `returnValue` is null. */
  error: string | null;
  /** The ledger the simulation ran against. */
  ledgerSequence: number;
}

async function simulate(context: CallContext, contractId: string, method: string, args: xdr.ScVal[]): Promise<Simulated> {
  const account: Account = await context.rpc.getAccount(context.source);
  const transaction = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: context.networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const response = await context.rpc.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(response)) {
    return { returnValue: null, error: String(response.error), ledgerSequence: response.latestLedger };
  }
  const returnValue = (response as rpc.Api.SimulateTransactionSuccessResponse).result?.retval ?? null;
  if (returnValue === null) throw new SimulationError(`${method} returned no value`);
  return { returnValue, error: null, ledgerSequence: response.latestLedger };
}

/** The first line of a failure message, which is the part worth showing. */
const firstLine = (text: string): string => text.split('\n')[0] ?? text;

/** Throws the contract's own error when there is one, a `SimulationError` otherwise. */
function unwrap(result: Simulated, method: string): xdr.ScVal {
  if (result.returnValue !== null) return result.returnValue;
  const text = result.error ?? 'unknown error';
  throw parseContractError(text) ?? new SimulationError(`${method} failed: ${firstLine(text)}`);
}

export interface OnChainDecision {
  decision: Decision;
  /** The ledger the contract was asked at. */
  ledgerSequence: number;
}

/** Asks the contract: does `subject` satisfy policy `policyId`? Needs no authorization. */
export async function evaluateOnChain(
  context: CallContext,
  options: { contractId: string; policyId: bigint | number; subject: string },
): Promise<OnChainDecision> {
  const result = await simulate(context, options.contractId, 'evaluate', [
    u64ToScVal(options.policyId),
    addressToScVal(options.subject),
  ]);
  return { decision: decodeDecision(unwrap(result, 'evaluate')), ledgerSequence: result.ledgerSequence };
}

/** Reads a stored policy. */
export async function getPolicy(
  context: CallContext,
  options: { contractId: string; policyId: bigint | number },
): Promise<{ policy: Policy; ledgerSequence: number }> {
  const result = await simulate(context, options.contractId, 'get', [u64ToScVal(options.policyId)]);
  return { policy: decodePolicy(unwrap(result, 'get')), ledgerSequence: result.ledgerSequence };
}

/**
 * Reads `balance(subject)` of a token (`i128`) or collection (`u32`). Any failure of the call itself (an error, a
 * panic, a missing function, an address that is not a contract) is `unavailable`, which is what the contract
 * reports as `BalanceUnavailable`. One difference: a token that exhausts its whole budget aborts the contract's
 * evaluation, so the contract gives no decision at all, while this reports `unavailable`.
 */
export async function readBalance(
  context: CallContext,
  options: { kind: 'token' | 'nft'; address: string; subject: string },
): Promise<{ reading: Reading; ledgerSequence: number }> {
  const result = await simulate(context, options.address, 'balance', [addressToScVal(options.subject)]);
  const reading = options.kind === 'token' ? decodeTokenBalance(result.returnValue) : decodeNftBalance(result.returnValue);
  return { reading, ledgerSequence: result.ledgerSequence };
}

/** Reads `decimals()` of a token (SEP-41: a `u32`), the number needed to turn a display amount into base units. */
export async function readDecimals(context: CallContext, tokenAddress: string): Promise<number> {
  const result = await simulate(context, tokenAddress, 'decimals', []);
  if (result.returnValue === null) {
    throw new SimulationError(`decimals() failed: ${firstLine(result.error ?? 'unknown error')}`);
  }
  if (result.returnValue.type !== 'scvU32') throw new DecodeError('decimals() did not return a u32');
  return scValToNative(result.returnValue) as number;
}

export interface SnapshotResult {
  snapshot: Snapshot;
  /** The one ledger every reading in the snapshot was taken at. */
  ledgerSequence: number;
}

/**
 * Collects what `evaluate` needs for `subject`: the ledger time and every balance a condition asks about. All
 * readings must come from the same ledger as the time, otherwise the snapshot is read again (up to `attempts`
 * times), because a balance and a time from different ledgers would not describe any moment that existed. The
 * balances are read in parallel.
 */
export async function fetchSnapshot(
  context: CallContext,
  options: { conditions: readonly Condition[]; subject: string; attempts?: number },
): Promise<SnapshotResult> {
  const attempts = options.attempts ?? 4;

  // Each distinct token or collection is read once, however many conditions name it.
  const sources = new Map<string, { kind: 'token' | 'nft'; address: string }>();
  for (const condition of options.conditions) {
    if (condition.type === 'time_window') continue;
    sources.set(readingKey(condition), {
      kind: condition.type === 'token_balance' ? 'token' : 'nft',
      address: condition.type === 'token_balance' ? condition.token : condition.collection,
    });
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const latest = await context.rpc.getLatestLedger();
    // In parallel: reading one after another can take longer than a ledger, and then no read is ever consistent.
    const results = await Promise.all(
      [...sources].map(async ([key, source]) => ({ key, ...(await readBalance(context, { ...source, subject: options.subject })) })),
    );
    if (results.every((r) => r.ledgerSequence === latest.sequence)) {
      const readings = new Map<string, Reading>(results.map((r) => [r.key, r.reading]));
      return { snapshot: { timestamp: BigInt(latest.closeTime), readings }, ledgerSequence: latest.sequence };
    }
  }
  throw new LedgerMovedError(attempts);
}
