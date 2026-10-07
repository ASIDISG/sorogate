/**
 * Measures what extends the lifetime of the policy contract's three entries on Stellar Testnet: its **instance**, its
 * **code** (the WASM) and a **policy**.
 *
 *   tsx scripts/testnet-ttl.ts --wasm <access_policy.wasm> --report report.json
 *
 * It deploys a fresh copy of the policy contract (throwaway keys, in memory only), then reads the lifetime of each entry
 * after each step: right after deployment, after `create`, after `bump` called by a different account, and after a plain
 * `evaluate` sent as a real transaction. A lifetime is a ledger number, the last ledger the entry is live in; the
 * script prints it as the number of ledgers remaining at the ledger it was read.
 *
 * Reading a lifetime changes nothing, so the steps are the only things that can move it. Not part of CI.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Address, Contract, Keypair, Networks, rpc, scValToNative, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

import { encodeConditions, u64ToScVal, type Condition } from '../src/index.js';
import { assertTestnet, deployWasm, fund, invoke, log, server, sleep, variantOf } from './testnet-lib.js';

const flag = (name: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
};
const WASM = resolve(flag('wasm'));
const REPORT = resolve(flag('report'));

const addr = (a: string) => new Address(a).toScVal();
const jsonOf = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString('hex') : x));
const DAY = 17_280;

interface Snapshot {
  step: string;
  /** The ledger the entries were read at. */
  ledger: number;
  /** Ledgers each entry has left at that ledger; `null` when the entry does not exist yet. */
  remaining: { instance: number; code: number; policy: number | null };
  /** The last ledger each entry is live in. */
  until: { instance: number; code: number; policy: number | null };
  /** The same, in days at five seconds a ledger. */
  days: { instance: number; code: number; policy: number | null };
}
const snapshots: Snapshot[] = [];

/** The ledger keys `get(id)` reads: the policy, the contract instance and its code, taken from a simulation of the call. */
async function keysFor(source: string, contractId: string, id: bigint): Promise<xdr.LedgerKey[]> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contractId).call('get', u64ToScVal(id)))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${String(sim.error)}`);
  const data = (sim as rpc.Api.SimulateTransactionSuccessResponse).transactionData;
  if (data === undefined) throw new Error('the simulation returned no footprint');
  return data.getReadOnly();
}

async function snapshot(step: string, source: string, contractId: string, policyId: bigint | null, wasmHash: string): Promise<void> {
  const keys =
    policyId === null
      ? [new Contract(contractId).getFootprint(), xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmHash, 'hex') }))]
      : await keysFor(source, contractId, policyId);
  const response = await server.getLedgerEntries(...keys);
  const found: { instance?: number; code?: number; policy?: number } = {};
  for (const entry of response.entries) {
    const until = entry.liveUntilLedgerSeq;
    if (until === undefined) continue;
    const text = jsonOf(entry.key);
    if (text.includes('contract_code')) found.code = until;
    else if (text.includes('ledger_key_contract_instance')) found.instance = until;
    else if (text.includes('Policy')) found.policy = until;
  }
  if (found.instance === undefined || found.code === undefined) throw new Error('could not read the instance and code lifetimes');
  const ledger = response.latestLedger;
  const left = (until: number | undefined): number | null => (until === undefined ? null : until - ledger);
  const days = (n: number | null): number | null => (n === null ? null : Math.round((n / DAY) * 100) / 100);
  const remaining = { instance: left(found.instance) as number, code: left(found.code) as number, policy: left(found.policy) };
  const until = { instance: found.instance, code: found.code, policy: found.policy ?? null };
  snapshots.push({ step, ledger, remaining, until, days: { instance: days(remaining.instance) as number, code: days(remaining.code) as number, policy: days(remaining.policy) } });
  const s = snapshots[snapshots.length - 1] as Snapshot;
  log(`${step.padEnd(52)} ledger ${ledger}: instance ${s.days.instance} d, code ${s.days.code} d, policy ${s.days.policy ?? '-'} d`);
}

async function main(): Promise<void> {
  const network = await assertTestnet();
  log(`Testnet, protocol ${network.protocolVersion}`);
  const owner = Keypair.random();
  const stranger = Keypair.random();
  await Promise.all([owner, stranger].map((k) => fund(k.publicKey())));
  await sleep(6000);

  // Code entries are keyed by hash and shared by every contract made from the same WASM, so a copy with an empty custom section
  // appended (its own hash) is deployed: otherwise the code could already have been extended by an earlier deployment.
  const wasm = readFileSync(WASM);
  const deployed = await deployWasm(owner, variantOf(wasm, `ttl-${Date.now()}`), []);
  const contractId = deployed.contractId;
  const wasmHash = deployed.wasmSha256;
  log(`deployed ${contractId}`);

  await snapshot('just deployed', owner.publicKey(), contractId, null, wasmHash);

  const conditions: Condition[] = [{ type: 'time_window', notBefore: 1n, notAfter: null }];
  const created = await invoke(owner, contractId, 'create', [addr(owner.publicKey()), encodeConditions(conditions)]);
  const policyId = scValToNative(created.returnValue as xdr.ScVal) as bigint;
  await snapshot('after create (a write by the owner)', owner.publicKey(), contractId, policyId, wasmHash);

  await sleep(30_000); // let some ledgers pass, so that a moving lifetime is visible and not lost in rounding
  await snapshot('thirty seconds later, nothing has touched it', owner.publicKey(), contractId, policyId, wasmHash);

  await invoke(stranger, contractId, 'bump', [u64ToScVal(policyId)]);
  await snapshot('after bump, called by a different account', owner.publicKey(), contractId, policyId, wasmHash);

  await sleep(30_000);
  await invoke(stranger, contractId, 'evaluate', [u64ToScVal(policyId), addr(stranger.publicKey())]);
  await snapshot('after evaluate sent as a real transaction', owner.publicKey(), contractId, policyId, wasmHash);

  const report = {
    label: 'Recorded',
    network: `Stellar Testnet (protocol ${network.protocolVersion})`,
    ranAt: new Date().toISOString(),
    contract: contractId,
    policyId: String(policyId),
    wasmSha256OfRepositoryBuild: createHash('sha256').update(wasm).digest('hex'),
    wasmSha256Deployed: wasmHash,
    note: 'The code deployed is the repository build with an empty custom section appended, so that its code entry is its own and not shared with the public deployment.',
    constants: { daysPerLedgersAtFiveSeconds: DAY, policyTopUpToDays: 90, policyTopUpThresholdDays: 30 },
    snapshots,
  };
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nwrote ${REPORT}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
