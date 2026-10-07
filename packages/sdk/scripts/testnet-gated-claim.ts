/**
 * Manual end-to-end run of the reference consumer (`gated-claim`) on Stellar Testnet.
 *
 *   tsx scripts/testnet-gated-claim.ts --wasm-dir <dir with access_policy.wasm, mock_token.wasm, gated_claim.wasm> \
 *       [--report report.json]
 *
 * Throwaway keys (in memory only, never printed or saved) are funded by friendbot. The script deploys the policy
 * contract, a test token, a reward asset and two consumers (one follows the policy, one is pinned to version 1), and
 * then walks through the scenarios in `docs/INTEGRATING.md`: an eligible address is paid once, the same address
 * cannot claim twice, an address below the minimum is refused, the owner raises the minimum and the consumers
 * follow (or refuse) without being redeployed, and nobody can claim for an address without its authorization.
 *
 * Every step records what was expected and what happened; any difference makes the exit code 1. It talks to a public
 * network and takes several minutes, so it is not part of CI.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Address, Asset, Contract, Keypair, nativeToScVal, Networks, Operation, rpc, scValToNative, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

import { encodeConditions, readBalance, u64ToScVal, type CallContext, type Condition } from '../src/index.js';
import { assertTestnet, deployWasm, fund, invoke, log, server, sleep, submit } from './testnet-lib.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
};
const WASM_DIR = resolve(arg('wasm-dir', '../../target/wasm32v1-none/release'));
const REPORT = process.argv.includes('--report') ? resolve(arg('report', 'report.json')) : null;

const STROOPS = 10_000_000n; // the reward asset has 7 decimals
const AMOUNT = 10n * STROOPS;
const POOL = 100n * STROOPS;

/** `gated-claim`'s error codes (contracts/gated-claim/src/lib.rs). */
const CONSUMER_ERRORS: Record<number, string> = {
  1: 'AlreadyClaimed',
  2: 'PolicyUnavailable',
  3: 'PolicyChanged',
  4: 'InvalidAmount',
  10: 'Inactive',
  11: 'BelowMinimum',
  12: 'BalanceUnavailable',
  13: 'BeforeWindow',
  14: 'AfterWindow',
};

const addr = (a: string) => new Address(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });

// ---------------------------------------------------------------- reading without sending

async function simulate(source: string, contractId: string, method: string, args: xdr.ScVal[]): Promise<{ value: unknown } | { error: string }> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const response = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(response)) return { error: String(response.error) };
  const retval = (response as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  return { value: retval === undefined ? undefined : scValToNative(retval) };
}

/** What `claim(subject)` would do right now: `ok`, or the consumer's own error by name. */
async function claimOutcome(consumer: string, subject: string): Promise<string> {
  const result = await simulate(subject, consumer, 'claim', [addr(subject)]);
  if ('value' in result) return 'ok';
  const code = /Error\(Contract, #(\d+)\)/.exec(result.error)?.[1];
  return code === undefined ? `other: ${result.error.split('\n')[0]}` : (CONSUMER_ERRORS[Number(code)] ?? `unknown code ${code}`);
}

const hasClaimed = async (consumer: string, source: string, subject: string): Promise<boolean> => {
  const result = await simulate(source, consumer, 'has_claimed', [addr(subject)]);
  if ('error' in result) throw new Error(`has_claimed failed: ${result.error}`);
  return result.value === true;
};

// ---------------------------------------------------------------- the run

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

async function main(): Promise<void> {
  const network = await assertTestnet();
  log(`Testnet, protocol ${network.protocolVersion}`);

  const [deployer, alice, bob, carol, dave] = Array.from({ length: 5 }, () => Keypair.random()) as [Keypair, Keypair, Keypair, Keypair, Keypair];
  log('funding five throwaway accounts with friendbot');
  await Promise.all([deployer, alice, bob, carol, dave].map((k) => fund(k.publicKey())));
  await sleep(6000);

  const read = (name: string) => readFileSync(resolve(WASM_DIR, name));
  log('deploying the policy contract and a test token');
  const policy = await deployWasm(deployer, read('access_policy.wasm'), []);
  const coin = await deployWasm(deployer, read('mock_token.wasm'), [nativeToScVal(0, { type: 'u32' })]);

  log('deploying the reward asset and giving every claimant a trustline');
  const asset = new Asset('SGR', deployer.publicKey());
  const rewardResult = await submit(deployer, Operation.createStellarAssetContract({ asset }), true);
  const reward = scValToNative(rewardResult.returnValue as xdr.ScVal) as string;
  for (const who of [alice, bob, carol, dave]) await submit(who, Operation.changeTrust({ asset }), false);

  log('creating the policy: hold at least 100 of the test token');
  const policyConditions = (min: bigint): Condition[] => [{ type: 'token_balance', token: coin.contractId, min }];
  const created = await invoke(deployer, policy.contractId, 'create', [addr(deployer.publicKey()), encodeConditions(policyConditions(100n))]);
  const policyId = scValToNative(created.returnValue as xdr.ScVal) as bigint;

  log('deploying two consumers of that policy: one follows it, one is pinned to version 1');
  const consumerWasm = read('gated_claim.wasm');
  const constructorArgs = (pinned: number | null) => [
    addr(policy.contractId),
    u64ToScVal(policyId),
    addr(reward),
    i128(AMOUNT),
    pinned === null ? xdr.ScVal.scvVoid() : nativeToScVal(pinned, { type: 'u32' }),
  ];
  const open = await deployWasm(deployer, consumerWasm, constructorArgs(null));
  const pinned = await deployWasm(deployer, consumerWasm, constructorArgs(1));
  for (const consumer of [open.contractId, pinned.contractId]) {
    // The issuer of an asset can pay out of nothing: that is how the pools are filled.
    await invoke(deployer, reward, 'transfer', [addr(deployer.publicKey()), addr(consumer), i128(POOL)]);
  }

  const setBalance = (who: Keypair, amount: bigint) => invoke(deployer, coin.contractId, 'set_balance', [addr(who.publicKey()), i128(amount)]);
  await setBalance(alice, 150n);
  await setBalance(bob, 150n);
  await setBalance(carol, 50n);
  await setBalance(dave, 150n);

  const ctx: CallContext = { rpc: server, networkPassphrase: Networks.TESTNET, source: deployer.publicKey() };
  const rewardOf = async (who: Keypair): Promise<string> => {
    const { reading } = await readBalance(ctx, { kind: 'token', address: reward, subject: who.publicKey() });
    return reading.status === 'ok' ? `${reading.value / STROOPS} SGR` : 'unavailable';
  };

  // ---- the scenarios
  log('--- scenarios');
  const claim = async (consumer: string, who: Keypair) => invoke(who, consumer, 'claim', [addr(who.publicKey())]);

  const first = await claim(open.contractId, alice);
  record('alice (150 of the token, minimum 100) claims', 'paid', 'paid', first.hash);
  record('alice now holds the reward', '10 SGR', await rewardOf(alice));
  record('the consumer remembers alice claimed', 'true', String(await hasClaimed(open.contractId, alice.publicKey(), alice.publicKey())));

  record('alice claims a second time', 'AlreadyClaimed', await claimOutcome(open.contractId, alice.publicKey()));
  record('carol (50 of the token) claims', 'BelowMinimum', await claimOutcome(open.contractId, carol.publicKey()));
  record('bob claims on the pinned consumer while the policy is still version 1', 'ok', await claimOutcome(pinned.contractId, bob.publicKey()));

  log('the policy owner raises the minimum to 500; neither consumer is touched');
  const update = await invoke(deployer, policy.contractId, 'update', [u64ToScVal(policyId), encodeConditions(policyConditions(500n))]);
  record('the owner updates the policy (a normal transaction)', 'done', 'done', update.hash);

  record('bob (150) claims on the consumer that follows the policy', 'BelowMinimum', await claimOutcome(open.contractId, bob.publicKey()));
  record('bob claims on the pinned consumer', 'PolicyChanged', await claimOutcome(pinned.contractId, bob.publicKey()));

  await setBalance(bob, 600n);
  const second = await claim(open.contractId, bob);
  record('bob (now 600) claims on the consumer that follows the policy', 'paid', 'paid', second.hash);
  record('bob now holds the reward', '10 SGR', await rewardOf(bob));
  record('bob, eligible under version 2, claims on the pinned consumer', 'PolicyChanged', await claimOutcome(pinned.contractId, bob.publicKey()));

  log('bob tries to claim on behalf of dave without dave\'s authorization');
  await setBalance(dave, 600n);
  let thiefOutcome = 'paid';
  try {
    await submit(bob, new Contract(open.contractId).call('claim', addr(dave.publicKey())), true);
  } catch {
    thiefOutcome = 'rejected';
  }
  record('bob signs a claim for dave, who is eligible but did not authorize it', 'rejected', thiefOutcome);
  record('dave has not been marked as claimed', 'false', String(await hasClaimed(open.contractId, deployer.publicKey(), dave.publicKey())));
  record('dave has not been paid', '0 SGR', await rewardOf(dave));
  const own = await claim(open.contractId, dave);
  record('dave claims for himself', 'paid', 'paid', own.hash);
  record('dave now holds the reward', '10 SGR', await rewardOf(dave));

  const pool = await readBalance(ctx, { kind: 'token', address: reward, subject: open.contractId });
  record('the open consumer\'s pool paid out three claims', '70 SGR', pool.reading.status === 'ok' ? `${pool.reading.value / STROOPS} SGR` : 'unavailable');

  const failures = steps.filter((s) => !s.ok);
  const summary = {
    label: 'Recorded',
    network: `Stellar Testnet (protocol ${network.protocolVersion})`,
    ranAt: new Date().toISOString(),
    steps: steps.length,
    unexpected: failures.length,
    contracts: {
      accessPolicy: policy.contractId,
      accessPolicyWasmSha256: policy.wasmSha256,
      testToken: coin.contractId,
      testTokenWasmSha256: coin.wasmSha256,
      rewardAssetContract: reward,
      consumerFollowingThePolicy: open.contractId,
      consumerPinnedToVersion1: pinned.contractId,
      consumerWasmSha256: open.wasmSha256,
      policyId: String(policyId),
    },
    results: steps,
  };
  if (REPORT !== null) writeFileSync(REPORT, JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n${steps.length - failures.length} of ${steps.length} steps happened as expected.`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
