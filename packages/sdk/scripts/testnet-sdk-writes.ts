/**
 * Manual check, on Stellar Testnet, of the SDK's transaction builders: the way a web page would change a policy.
 *
 *   tsx scripts/testnet-sdk-writes.ts --wasm-dir <dir with access_policy.wasm and mock_token.wasm> [--report report.json]
 *
 * Throwaway keys (in memory only, never printed or saved) are funded by friendbot. Each change is built unsigned by
 * `prepareCreatePolicy`, `prepareUpdatePolicy` or `prepareSetActive`, signed here the way a wallet would sign it, and
 * sent with `submitSigned`. The script then reads the policy back and checks the contract did what was asked, and also
 * checks the refusals: a contract-side validation error, an unknown policy, and someone who is not the owner.
 *
 * Every step records what was expected and what happened; any difference makes the exit code 1. It talks to a public
 * network, so it is not part of CI.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Keypair, nativeToScVal, Networks, scValToNative, type xdr } from '@stellar/stellar-sdk';

import { evaluateOnChain, getPolicy, type CallContext } from '../src/client.js';
import { InvalidPolicyError, prepareCreatePolicy, prepareSetActive, prepareUpdatePolicy, submitSigned, type PreparedTransaction, type WriteContext } from '../src/transactions.js';
import type { Condition } from '../src/types.js';
import { assertTestnet, deployWasm, fund, log, server, sleep } from './testnet-lib.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
};
const WASM_DIR = resolve(arg('wasm-dir', '../../target/wasm32v1-none/release'));
const REPORT = process.argv.includes('--report') ? resolve(arg('report', 'report.json')) : null;

interface Step {
  step: string;
  expected: string;
  actual: string;
  ok: boolean;
  txHash?: string;
}
const steps: Step[] = [];
function record(step: string, expected: string, actual: string, txHash?: string): void {
  const ok = expected === actual;
  steps.push({ step, expected, actual, ok, ...(txHash === undefined ? {} : { txHash }) });
  log(`${ok ? 'OK  ' : 'FAIL'} ${step}: expected ${expected}, got ${actual}`);
}

/** What happened to a promise, as a short word: the value's kind, or the name of the error. */
async function outcome<T>(promise: Promise<T>, onValue: (v: T) => string): Promise<string> {
  try {
    return onValue(await promise);
  } catch (error) {
    if (error instanceof InvalidPolicyError) return `InvalidPolicyError(${error.errorName})`;
    const named = error as { name?: string; errorName?: string };
    return named.errorName ? `${named.name}(${named.errorName})` : (named.name ?? 'error');
  }
}

async function main(): Promise<void> {
  const network = await assertTestnet();
  log(`Testnet, protocol ${network.protocolVersion}`);

  const owner = Keypair.random();
  const intruder = Keypair.random();
  log('funding two throwaway accounts with friendbot');
  await Promise.all([owner, intruder].map((k) => fund(k.publicKey())));
  await sleep(6000);

  const read = (name: string) => readFileSync(resolve(WASM_DIR, name));
  log('deploying the policy contract and a test token');
  const policy = await deployWasm(owner, read('access_policy.wasm'), []);
  const coin = await deployWasm(owner, read('mock_token.wasm'), [nativeToScVal(0, { type: 'u32' })]);

  const writes: WriteContext = { rpc: server, networkPassphrase: Networks.TESTNET };
  const reads: CallContext = { rpc: server, networkPassphrase: Networks.TESTNET, source: owner.publicKey() };
  const at = (min: bigint): Condition[] => [{ type: 'token_balance', token: coin.contractId, min }];
  /** Signs the way a wallet would, then sends. */
  const send = async (prepared: PreparedTransaction, signer: Keypair) => {
    prepared.transaction.sign(signer);
    return submitSigned(writes, prepared.transaction.toXDR(), { pollMs: 1500, timeoutMs: 90_000 });
  };
  const stored = async (policyId: bigint) => (await getPolicy(reads, { contractId: policy.contractId, policyId })).policy;
  const summary = (p: { version: number; active: boolean; conditions: readonly Condition[] }) =>
    `version ${p.version}, ${p.active ? 'active' : 'inactive'}, ${p.conditions.map((c) => (c.type === 'token_balance' ? `minimum ${c.min}` : c.type)).join(' and ')}`;

  log('--- changes made with the builders');
  const created = await send(await prepareCreatePolicy(writes, { contractId: policy.contractId, owner: owner.publicKey(), conditions: at(100n) }), owner);
  const policyId = scValToNative(created.returnValue as xdr.ScVal) as bigint;
  record('create, signed by the owner: the new policy id comes back', '1', String(policyId), created.hash);
  record('the stored policy is what was sent', 'version 1, active, minimum 100', summary(await stored(policyId)));

  const updated = await send(await prepareUpdatePolicy(writes, { contractId: policy.contractId, owner: owner.publicKey(), policyId, conditions: at(500n) }), owner);
  record('update, signed by the owner', 'version 2, active, minimum 500', summary(await stored(policyId)), updated.hash);

  const off = await send(await prepareSetActive(writes, { contractId: policy.contractId, owner: owner.publicKey(), policyId, active: false }), owner);
  record('set_active(false), signed by the owner', 'version 2, inactive, minimum 500', summary(await stored(policyId)), off.hash);
  const denied = await evaluateOnChain(reads, { contractId: policy.contractId, policyId, subject: owner.publicKey() });
  record('an inactive policy denies, whatever the balance', 'Inactive', denied.decision.reason);

  const on = await send(await prepareSetActive(writes, { contractId: policy.contractId, owner: owner.publicKey(), policyId, active: true }), owner);
  record('set_active(true) brings it back, version unchanged', 'version 2, active, minimum 500', summary(await stored(policyId)), on.hash);

  log('--- refusals');
  record('a policy the SDK can see is invalid never reaches the network', 'InvalidPolicyError(InvalidMinimum)', await outcome(prepareCreatePolicy(writes, { contractId: policy.contractId, owner: owner.publicKey(), conditions: at(0n) }), () => 'built'));
  record(
    'the contract refuses an account address as a token while the transaction is being prepared',
    'ContractCallError(NotAContract)',
    await outcome(prepareCreatePolicy(writes, { contractId: policy.contractId, owner: owner.publicKey(), conditions: [{ type: 'token_balance', token: intruder.publicKey(), min: 1n }] }), () => 'built'),
  );
  record('updating a policy that does not exist', 'ContractCallError(PolicyNotFound)', await outcome(prepareUpdatePolicy(writes, { contractId: policy.contractId, owner: owner.publicKey(), policyId: 999n, conditions: at(1n) }), () => 'built'));

  log('--- someone who is not the owner tries to change the policy');
  const attack = await outcome(
    (async () => send(await prepareUpdatePolicy(writes, { contractId: policy.contractId, owner: intruder.publicKey(), policyId, conditions: at(1n) }), intruder))(),
    () => 'applied',
  );
  record('the intruder signs an update of the owner\'s policy (refused either while preparing or when applied)', 'refused', attack === 'applied' ? 'applied' : 'refused');
  log(`   how it was refused: ${attack}`);
  record('the policy is unchanged', 'version 2, active, minimum 500', summary(await stored(policyId)));

  const failures = steps.filter((s) => !s.ok);
  const result = {
    label: 'Recorded',
    network: `Stellar Testnet (protocol ${network.protocolVersion})`,
    ranAt: new Date().toISOString(),
    steps: steps.length,
    unexpected: failures.length,
    howTheIntruderWasRefused: attack,
    contracts: { accessPolicy: policy.contractId, accessPolicyWasmSha256: policy.wasmSha256, testToken: coin.contractId, testTokenWasmSha256: coin.wasmSha256 },
    results: steps,
  };
  if (REPORT !== null) writeFileSync(REPORT, JSON.stringify(result, null, 2) + '\n');
  console.log(`\n${steps.length - failures.length} of ${steps.length} steps happened as expected.`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
