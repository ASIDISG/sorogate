/**
 * Building and sending the transactions that change a policy: `create`, `update` and `set_active`.
 *
 * The functions that build a transaction return it **unsigned**, so a wallet (or a test key) can sign it, and
 * `submitSigned` sends what comes back. Nothing here holds a key. The account that owns the policy must be the
 * transaction's source, which is how the contract's `require_auth` on the owner is satisfied by one signature.
 */
import { Contract, nativeToScVal, TransactionBuilder, type rpc, type Transaction, type xdr } from '@stellar/stellar-sdk';

import { firstLine, parseContractError, SimulationError } from './client.js';
import { addressToScVal, encodeConditions, u64ToScVal } from './scval.js';
import type { Condition, ContractErrorName } from './types.js';
import { validateConditions } from './validate.js';

/** The part of `rpc.Server` used to change a policy, so tests can supply a stand-in. */
export type WriteRpc = Pick<rpc.Server, 'getAccount' | 'prepareTransaction' | 'sendTransaction' | 'getTransaction'>;

export interface WriteContext {
  rpc: WriteRpc;
  networkPassphrase: string;
}

export interface PrepareOptions {
  /** The inclusive fee bid per operation, in stroops. The resource fee is added on top. Defaults to the network minimum, 100. */
  fee?: string;
  /** How long the transaction stays valid, in seconds. Defaults to five minutes, so a person has time to sign. */
  timeoutSeconds?: number;
}

/** An unsigned transaction, ready to be signed. */
export interface PreparedTransaction {
  transaction: Transaction;
  /** The same transaction as base64 XDR, the form a wallet takes. */
  xdr: string;
}

/** The conditions would be refused by the contract; checked before anything is sent anywhere. */
export class InvalidPolicyError extends Error {
  constructor(public readonly errorName: ContractErrorName) {
    super(`The policy is not valid: ${errorName}`);
    this.name = 'InvalidPolicyError';
  }
}

/** The network refused the transaction before running it. */
export class SubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmissionError';
  }
}

/** The transaction ran and failed. Nothing it did was kept. */
export class TransactionFailedError extends Error {
  constructor(public readonly hash: string) {
    super(`The transaction ${hash} failed`);
    this.name = 'TransactionFailedError';
  }
}

/** The transaction was not seen on the network in time. It may still be applied later. */
export class TransactionTimeoutError extends Error {
  constructor(public readonly hash: string) {
    super(`The transaction ${hash} was not confirmed in time; it may still be applied`);
    this.name = 'TransactionTimeoutError';
  }
}

async function prepareCall(
  context: WriteContext,
  call: { source: string; contractId: string; method: string; args: xdr.ScVal[] },
  options: PrepareOptions,
): Promise<PreparedTransaction> {
  const account = await context.rpc.getAccount(call.source);
  const built = new TransactionBuilder(account, { fee: options.fee ?? '100', networkPassphrase: context.networkPassphrase })
    .addOperation(new Contract(call.contractId).call(call.method, ...call.args))
    .setTimeout(options.timeoutSeconds ?? 300)
    .build();
  let transaction: Transaction;
  try {
    // Simulates the call, then adds the resource limits, the fee and the authorization it needs.
    transaction = await context.rpc.prepareTransaction(built);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    throw parseContractError(text) ?? new SimulationError(`${call.method} failed: ${firstLine(text)}`);
  }
  return { transaction, xdr: transaction.toXDR() };
}

function requireValid(conditions: readonly Condition[]): void {
  const result = validateConditions(conditions);
  if (!result.ok) throw new InvalidPolicyError(result.error);
}

/** An unsigned `create(owner, conditions)`. The owner must sign, and must be the source account. */
export async function prepareCreatePolicy(
  context: WriteContext,
  options: { contractId: string; owner: string; conditions: readonly Condition[] } & PrepareOptions,
): Promise<PreparedTransaction> {
  requireValid(options.conditions);
  return prepareCall(
    context,
    { source: options.owner, contractId: options.contractId, method: 'create', args: [addressToScVal(options.owner), encodeConditions(options.conditions)] },
    options,
  );
}

/** An unsigned `update(policy id, conditions)`. It replaces the conditions and raises the version by one. */
export async function prepareUpdatePolicy(
  context: WriteContext,
  options: { contractId: string; owner: string; policyId: bigint | number; conditions: readonly Condition[] } & PrepareOptions,
): Promise<PreparedTransaction> {
  requireValid(options.conditions);
  return prepareCall(
    context,
    { source: options.owner, contractId: options.contractId, method: 'update', args: [u64ToScVal(options.policyId), encodeConditions(options.conditions)] },
    options,
  );
}

/** An unsigned `set_active(policy id, active)`. An inactive policy denies everyone. */
export async function prepareSetActive(
  context: WriteContext,
  options: { contractId: string; owner: string; policyId: bigint | number; active: boolean } & PrepareOptions,
): Promise<PreparedTransaction> {
  return prepareCall(
    context,
    { source: options.owner, contractId: options.contractId, method: 'set_active', args: [u64ToScVal(options.policyId), nativeToScVal(options.active)] },
    options,
  );
}

export interface SubmitOptions {
  /** How long to wait for the network to confirm, in milliseconds. Defaults to 60 seconds. */
  timeoutMs?: number;
  /** How often to ask, in milliseconds. Defaults to 1.5 seconds. */
  pollMs?: number;
}

export interface SubmittedTransaction {
  hash: string;
  ledger: number;
  /** What the contract function returned, for example the new policy id of `create`. */
  returnValue: xdr.ScVal | undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends a signed transaction (base64 XDR) and waits until the network has applied it or refused it. */
export async function submitSigned(context: WriteContext, signedXdr: string, options: SubmitOptions = {}): Promise<SubmittedTransaction> {
  const transaction = TransactionBuilder.fromXDR(signedXdr, context.networkPassphrase);
  if ('innerTransaction' in transaction) throw new SubmissionError('A fee-bump transaction cannot be submitted here');

  const sent = await context.rpc.sendTransaction(transaction);
  if (sent.status === 'ERROR') throw new SubmissionError(`The network refused the transaction: ${JSON.stringify(sent.errorResult ?? sent.status)}`);
  if (sent.status === 'TRY_AGAIN_LATER') throw new SubmissionError('The network is busy; try again in a moment');

  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    const result = await context.rpc.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') return { hash: sent.hash, ledger: result.ledger, returnValue: result.returnValue };
    if (result.status === 'FAILED') throw new TransactionFailedError(sent.hash);
    if (Date.now() >= deadline) throw new TransactionTimeoutError(sent.hash);
    await sleep(options.pollMs ?? 1_500);
  }
}
