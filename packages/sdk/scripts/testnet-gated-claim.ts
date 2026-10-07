/**
 * Manual end-to-end run of the reference consumer (`gated-claim`) on Stellar Testnet.
 *
 *   tsx scripts/testnet-gated-claim.ts --wasm-dir <dir with access_policy.wasm, mock_token.wasm, gated_claim.wasm> \
 *       [--policy-contract <C...>] [--report report.json]
 *
 * With `--policy-contract` the run uses an already deployed policy contract (the public Testnet deployment in
 * `docs/DEPLOYMENT.md`), after checking that the code the network holds for it is the local `access_policy.wasm`.
 * Without it, the script deploys its own.
 *
 * Throwaway keys (in memory only, never printed or saved) are funded by friendbot. The script deploys a test token,
 * a reward asset and two consumers (one follows the policy, one is pinned to version 1), and walks through the
 * scenarios in `docs/INTEGRATING.md`.
 *
 * Every step is labelled as a **transaction** (sent to the network and applied), a **simulation** (asked of the
 * network without applying anything) or a **reading** (a value read from the network). The refusals that matter are
 * transactions: a claim is prepared and signed while its account is eligible, the policy owner then changes the
 * policy, and only then is the claim sent, so the consumer refuses it on the network and the transaction fails with
 * the consumer's own error code. The claim signed by someone other than the subject is likewise sent for real, and its
 * failure must be an authorization failure.
 *
 * Every step records what was expected and what happened; any difference makes the exit code 1. It talks to a public
 * network and takes several minutes, so it is not part of CI.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import { encodeConditions, readBalance, u64ToScVal, type CallContext, type Condition } from '../src/index.js';
import { assertTestnet, deployWasm, fund, invoke, log, server, sleep, submit } from './testnet-lib.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
};
const WASM_DIR = resolve(arg('wasm-dir', '../../target/wasm32v1-none/release'));
const REPORT = process.argv.includes('--report') ? resolve(arg('report', 'report.json')) : null;
const PUBLIC_POLICY = process.argv.includes('--policy-contract') ? arg('policy-contract', '') : null;

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
const jsonOf = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? `0x${Buffer.from(v).toString('hex')}` : v));

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

/** What `claim(subject)` would do right now: `ok`, or the consumer's own error by name. A simulation: nothing is applied. */
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

// ---------------------------------------------------------------- sending a transaction that is expected to fail

/** What the network did with a transaction that was sent: applied, failed when applied, or refused before that. */
interface Outcome {
  hash: string;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  /** The consumer's or policy contract's own error codes found in the diagnostic events, e.g. `11`. */
  contractCodes: number[];
  /** Host authorization errors found in the diagnostic events, e.g. `invalid_action`. */
  authErrors: string[];
  /** The raw result and events, as JSON, so the codes above can be checked by reading them. */
  raw: string;
}

/** Sends a signed transaction and reports exactly how it ended, instead of throwing on a failure. */
async function sendAndWatch(tx: Transaction): Promise<Outcome> {
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    const raw = jsonOf({ errorResult: sent.errorResult, diagnosticEvents: (sent as unknown as { diagnosticEventsXdr?: unknown }).diagnosticEventsXdr });
    return { hash: sent.hash, status: 'REJECTED', ...scan(raw), raw };
  }
  for (let i = 0; i < 60; i++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') return { hash: sent.hash, status: 'SUCCESS', contractCodes: [], authErrors: [], raw: '' };
    if (result.status === 'FAILED') {
      const failed = result as unknown as { resultXdr?: unknown; diagnosticEventsXdr?: unknown };
      const raw = jsonOf({ result: failed.resultXdr, diagnosticEvents: failed.diagnosticEventsXdr });
      return { hash: sent.hash, status: 'FAILED', ...scan(raw), raw };
    }
    await sleep(1500);
  }
  throw new Error(`transaction not confirmed in time: ${sent.hash}`);
}

/** Pulls the error codes out of a failed transaction's JSON. The shapes are matched to what real failures looked like. */
function scan(raw: string): { contractCodes: number[]; authErrors: string[] } {
  // A diagnostic event carries its error as `{"error":{"contract":11}}` or `{"error":{"auth":"invalid_action"}}`.
  const codes = new Set<number>();
  for (const m of raw.matchAll(/"error":\{"contract":(\d+)\}/g)) codes.add(Number(m[1]));
  const auth = new Set<string>();
  for (const m of raw.matchAll(/"error":\{"auth":"([a-z_]+)"\}/g)) auth.add(m[1] as string);
  return { contractCodes: [...codes], authErrors: [...auth] };
}

/** A claim, prepared (simulated, so resources and authorization are filled in) and signed, but not sent. */
async function prepareClaim(consumer: string, signer: Keypair, account: Account, subject: string): Promise<Transaction> {
  let tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(consumer).call('claim', addr(subject)))
    .setTimeout(900)
    .build();
  tx = await server.prepareTransaction(tx);
  tx.sign(signer);
  return tx;
}

const describeFailure = (o: Outcome): string => {
  if (o.status === 'SUCCESS') return 'paid';
  const parts: string[] = [];
  if (o.authErrors.length > 0) parts.push(`authorization error (${o.authErrors.join(', ')})`);
  for (const code of o.contractCodes) parts.push(`${CONSUMER_ERRORS[code] ?? `error ${code}`} (contract error ${code})`);
  return `${o.status}: ${parts.length > 0 ? parts.join('; ') : 'no error code found'}`;
};

// ---------------------------------------------------------------- the run

type Kind = 'transaction' | 'simulation' | 'reading';
interface Step {
  step: string;
  kind: Kind;
  expected: string;
  actual: string;
  ok: boolean;
  txHash?: string;
}
const steps: Step[] = [];
function record(step: string, kind: Kind, expected: string, actual: string, txHash?: string): void {
  const ok = expected === actual;
  steps.push({ step, kind, expected, actual, ok, ...(txHash === undefined ? {} : { txHash }) });
  log(`${ok ? 'OK  ' : 'FAIL'} [${kind}] ${step}: expected ${expected}, got ${actual}`);
}

async function main(): Promise<void> {
  const network = await assertTestnet();
  log(`Testnet, protocol ${network.protocolVersion}`);

  const [deployer, alice, bob, carol, dave, erin] = Array.from({ length: 6 }, () => Keypair.random()) as [
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
  ];
  log('funding six throwaway accounts with friendbot');
  await Promise.all([deployer, alice, bob, carol, dave, erin].map((k) => fund(k.publicKey())));
  await sleep(6000);

  const read = (name: string) => readFileSync(resolve(WASM_DIR, name));

  let policy: { contractId: string; wasmSha256: string };
  if (PUBLIC_POLICY !== null) {
    const local = read('access_policy.wasm');
    const onChain = Buffer.from(await server.getContractWasmByContractId(PUBLIC_POLICY));
    record(
      "the policy contract is the public deployment, and the code the network holds is this repository's build",
      'reading',
      'identical',
      onChain.equals(local) ? 'identical' : 'DIFFERENT',
    );
    policy = { contractId: PUBLIC_POLICY, wasmSha256: createHash('sha256').update(onChain).digest('hex') };
  } else {
    log('deploying a policy contract of its own');
    policy = await deployWasm(deployer, read('access_policy.wasm'), []);
  }

  log('deploying a test token');
  const coin = await deployWasm(deployer, read('mock_token.wasm'), [nativeToScVal(0, { type: 'u32' })]);

  log('deploying the reward asset and giving every claimant a trustline');
  const asset = new Asset('SGR', deployer.publicKey());
  const rewardResult = await submit(deployer, Operation.createStellarAssetContract({ asset }), true);
  const reward = scValToNative(rewardResult.returnValue as xdr.ScVal) as string;
  for (const who of [alice, bob, carol, dave, erin]) await submit(who, Operation.changeTrust({ asset }), false);

  log('creating the policy: hold at least 100 of the test token');
  const policyConditions = (min: bigint): Condition[] => [{ type: 'token_balance', token: coin.contractId, min }];
  const created = await invoke(deployer, policy.contractId, 'create', [addr(deployer.publicKey()), encodeConditions(policyConditions(100n))]);
  const policyId = scValToNative(created.returnValue as xdr.ScVal) as bigint;

  log('deploying two consumers of that policy: one follows it, one is pinned to version 1');
  const consumerWasm = read('gated_claim.wasm');
  const constructorArgs = (pinnedVersion: number | null) => [
    addr(policy.contractId),
    u64ToScVal(policyId),
    addr(reward),
    i128(AMOUNT),
    pinnedVersion === null ? xdr.ScVal.scvVoid() : nativeToScVal(pinnedVersion, { type: 'u32' }),
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
  await setBalance(erin, 150n);

  const ctx: CallContext = { rpc: server, networkPassphrase: Networks.TESTNET, source: deployer.publicKey() };
  const rewardOf = async (who: string): Promise<string> => {
    const { reading } = await readBalance(ctx, { kind: 'token', address: reward, subject: who });
    return reading.status === 'ok' ? `${reading.value / STROOPS} SGR` : 'unavailable';
  };
  const claim = async (consumer: string, who: Keypair) => invoke(who, consumer, 'claim', [addr(who.publicKey())]);

  // ---- version 1 of the policy
  log('--- policy version 1: hold at least 100');
  const first = await claim(open.contractId, alice);
  record('alice (150 of the token, minimum 100) claims on the consumer that follows the policy', 'transaction', 'paid', 'paid', first.hash);
  record('alice now holds the reward', 'reading', '10 SGR', await rewardOf(alice.publicKey()));
  record('the consumer remembers alice claimed', 'reading', 'true', String(await hasClaimed(open.contractId, alice.publicKey(), alice.publicKey())));
  record('alice claims a second time', 'simulation', 'AlreadyClaimed', await claimOutcome(open.contractId, alice.publicKey()));
  record('carol (50 of the token) claims', 'simulation', 'BelowMinimum', await claimOutcome(open.contractId, carol.publicKey()));

  const pinnedFirst = await claim(pinned.contractId, erin);
  record('erin (150) claims on the consumer pinned to version 1, while the policy is at version 1', 'transaction', 'paid', 'paid', pinnedFirst.hash);
  record('erin now holds the reward', 'reading', '10 SGR', await rewardOf(erin.publicKey()));
  record('the pinned consumer remembers erin claimed', 'reading', 'true', String(await hasClaimed(pinned.contractId, erin.publicKey(), erin.publicKey())));

  // Two claims for bob, prepared and signed now, while he is eligible under version 1. They are sent after the policy
  // changes, so the consumers refuse them on the network rather than in a simulation.
  log('preparing two claims for bob while the policy is still at version 1; they will be sent after it changes');
  const bobAccount = await server.getAccount(bob.publicKey());
  const bobOnOpen = await prepareClaim(open.contractId, bob, bobAccount, bob.publicKey());
  const bobOnPinned = await prepareClaim(pinned.contractId, bob, bobAccount, bob.publicKey());

  log('--- the policy owner raises the minimum to 500; neither consumer is touched');
  const update = await invoke(deployer, policy.contractId, 'update', [u64ToScVal(policyId), encodeConditions(policyConditions(500n))]);
  record('the owner updates the policy (a normal transaction)', 'transaction', 'done', 'done', update.hash);

  // ---- version 2 of the policy
  const refusedOpen = await sendAndWatch(bobOnOpen);
  record(
    "bob's claim, signed under version 1, is sent now to the consumer that follows the policy",
    'transaction',
    'FAILED: BelowMinimum (contract error 11)',
    describeFailure(refusedOpen),
    refusedOpen.hash,
  );
  const refusedPinned = await sendAndWatch(bobOnPinned);
  record(
    "bob's claim, signed under version 1, is sent now to the consumer pinned to version 1",
    'transaction',
    'FAILED: PolicyChanged (contract error 3)',
    describeFailure(refusedPinned),
    refusedPinned.hash,
  );
  record('the refusals did not pay bob', 'reading', '0 SGR', await rewardOf(bob.publicKey()));
  record('nor mark him as claimed on the consumer that follows the policy', 'reading', 'false', String(await hasClaimed(open.contractId, deployer.publicKey(), bob.publicKey())));
  record('nor on the pinned consumer', 'reading', 'false', String(await hasClaimed(pinned.contractId, deployer.publicKey(), bob.publicKey())));

  await setBalance(bob, 600n);
  const second = await claim(open.contractId, bob);
  record('bob (now 600) claims on the consumer that follows the policy', 'transaction', 'paid', 'paid', second.hash);
  record('bob now holds the reward', 'reading', '10 SGR', await rewardOf(bob.publicKey()));
  record('bob, eligible under version 2, claims on the pinned consumer', 'simulation', 'PolicyChanged', await claimOutcome(pinned.contractId, bob.publicKey()));

  // ---- authentication: eligibility is not identity
  log('--- bob signs a claim for dave, who is eligible but did not authorize it');
  await setBalance(dave, 600n);
  record('dave is eligible: the policy would allow him', 'simulation', 'ok', await claimOutcome(open.contractId, dave.publicKey()));
  const forged = await prepareClaim(open.contractId, bob, await server.getAccount(bob.publicKey()), dave.publicKey());
  const forgedOutcome = await sendAndWatch(forged);
  const forgedActual =
    forgedOutcome.status !== 'SUCCESS' && forgedOutcome.authErrors.length > 0 && forgedOutcome.contractCodes.length === 0
      ? `${forgedOutcome.status} with an authorization error`
      : describeFailure(forgedOutcome);
  record('bob signs and sends a claim for dave', 'transaction', 'FAILED with an authorization error', forgedActual, forgedOutcome.hash);
  record('dave has not been marked as claimed', 'reading', 'false', String(await hasClaimed(open.contractId, deployer.publicKey(), dave.publicKey())));
  record('dave has not been paid', 'reading', '0 SGR', await rewardOf(dave.publicKey()));
  const own = await claim(open.contractId, dave);
  record('dave claims for himself, in the same state', 'transaction', 'paid', 'paid', own.hash);
  record('dave now holds the reward', 'reading', '10 SGR', await rewardOf(dave.publicKey()));

  const openPool = await readBalance(ctx, { kind: 'token', address: reward, subject: open.contractId });
  record('the consumer that follows the policy paid out three claims', 'reading', '70 SGR', openPool.reading.status === 'ok' ? `${openPool.reading.value / STROOPS} SGR` : 'unavailable');
  const pinnedPool = await readBalance(ctx, { kind: 'token', address: reward, subject: pinned.contractId });
  record('the pinned consumer paid out one claim', 'reading', '90 SGR', pinnedPool.reading.status === 'ok' ? `${pinnedPool.reading.value / STROOPS} SGR` : 'unavailable');

  const failures = steps.filter((s) => !s.ok);
  const summary = {
    label: 'Recorded',
    stepKinds: {
      transaction: 'sent to the network and applied (a failed transaction was applied, and failed)',
      simulation: 'asked of the network without applying anything',
      reading: 'a value read from the network',
    },
    network: `Stellar Testnet (protocol ${network.protocolVersion})`,
    ranAt: new Date().toISOString(),
    steps: steps.length,
    unexpected: failures.length,
    publicPolicyContractUsed: PUBLIC_POLICY !== null,
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
    accounts: Object.fromEntries(
      Object.entries({ policyOwnerAndDeployer: deployer, alice, bob, carol, dave, erin }).map(([name, key]) => [name, key.publicKey()]),
    ),
    callPath:
      'consumer.claim(subject) -> subject.require_auth() -> policy.try_evaluate(policyId, subject) -> pinned-version check -> decision -> record claim -> reward.transfer',
    failedTransactions: {
      belowMinimum: { hash: refusedOpen.hash, status: refusedOpen.status, contractCodes: refusedOpen.contractCodes },
      policyChanged: { hash: refusedPinned.hash, status: refusedPinned.status, contractCodes: refusedPinned.contractCodes },
      signedBySomeoneElse: {
        hash: forgedOutcome.hash,
        status: forgedOutcome.status,
        authErrors: forgedOutcome.authErrors,
        contractCodes: forgedOutcome.contractCodes,
        rawResultAndEvents: forgedOutcome.raw.slice(0, 6000),
      },
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
