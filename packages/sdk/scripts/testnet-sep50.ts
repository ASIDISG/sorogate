/**
 * Manual check, on Stellar Testnet, of the `NftBalance` condition against a real SEP-50 collection: OpenZeppelin's
 * `nft-sequential-minting` example, built from its own repository at a pinned tag.
 *
 *   tsx scripts/testnet-sep50.ts --wasm-dir <dir with access_policy.wasm and gated_claim.wasm> \
 *       --nft-wasm <nft_sequential_minting_example.wasm> --nft-source <text> \
 *       --policy-contract <C...> [--report report.json]
 *
 * It asks the collection for `balance(owner)` and records the raw type that comes back (the condition assumes a
 * `u32`), creates policies on the public policy contract, and compares the contract's answer with the TypeScript
 * model's for holders and non-holders. It then moves a token between accounts to show that eligibility follows
 * current ownership, and runs the reference consumer against an NFT policy: a holder is paid, a claim signed while the
 * holder owned the token is refused once the token has been transferred away. Last, it points an `NftBalance` condition
 * at a fungible token, which answers `balance` with an `i128`, to record the failure behaviour on a real contract.
 *
 * Throwaway keys (in memory only, never printed or saved). Every step records what was expected and what happened;
 * any difference makes the exit code 1. It talks to a public network, so it is not part of CI.
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

import {
  encodeConditions,
  evaluate,
  evaluateOnChain,
  fetchSnapshot,
  getPolicy,
  readBalance,
  u64ToScVal,
  type CallContext,
  type Condition,
  type Decision,
} from '../src/index.js';
import { assertTestnet, deployWasm, fund, invoke, log, server, sleep, submit } from './testnet-lib.js';

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
};
const WASM_DIR = resolve(arg('wasm-dir', '../../target/wasm32v1-none/release'));
const NFT_WASM = resolve(arg('nft-wasm'));
const NFT_SOURCE = arg('nft-source');
const POLICY_CONTRACT = arg('policy-contract');
const REPORT = process.argv.includes('--report') ? resolve(arg('report', 'report.json')) : null;

const STROOPS = 10_000_000n;
const AMOUNT = 10n * STROOPS;
const POOL = 100n * STROOPS;
const CONSUMER_ERRORS: Record<number, string> = { 1: 'AlreadyClaimed', 2: 'PolicyUnavailable', 3: 'PolicyChanged', 11: 'BelowMinimum', 12: 'BalanceUnavailable' };

const addr = (a: string) => new Address(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const str = (s: string) => nativeToScVal(s, { type: 'string' });
const jsonOf = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? `0x${Buffer.from(v).toString('hex')}` : v));

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

/** Simulates a call and returns the raw return value, so its XDR type can be recorded. */
async function simulateRaw(source: string, contractId: string, method: string, args: xdr.ScVal[]): Promise<{ value: xdr.ScVal } | { error: string }> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const response = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(response)) return { error: String(response.error) };
  const retval = (response as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  if (retval === undefined) return { error: 'no return value' };
  return { value: retval };
}

interface Outcome {
  hash: string;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  contractCodes: number[];
}
async function sendAndWatch(tx: Transaction): Promise<Outcome> {
  const scan = (raw: string): number[] => [...new Set([...raw.matchAll(/"error":\{"contract":(\d+)\}/g)].map((m) => Number(m[1])))];
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') return { hash: sent.hash, status: 'REJECTED', contractCodes: scan(jsonOf(sent)) };
  for (let i = 0; i < 60; i++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') return { hash: sent.hash, status: 'SUCCESS', contractCodes: [] };
    if (result.status === 'FAILED') {
      const failed = result as unknown as { resultXdr?: unknown; diagnosticEventsXdr?: unknown };
      return { hash: sent.hash, status: 'FAILED', contractCodes: scan(jsonOf({ result: failed.resultXdr, events: failed.diagnosticEventsXdr })) };
    }
    await sleep(1500);
  }
  throw new Error(`not confirmed in time: ${sent.hash}`);
}
async function prepareClaim(consumer: string, signer: Keypair, account: Account, subject: string): Promise<Transaction> {
  let tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(consumer).call('claim', addr(subject)))
    .setTimeout(900)
    .build();
  tx = await server.prepareTransaction(tx);
  tx.sign(signer);
  return tx;
}
const describe = (o: Outcome): string =>
  o.status === 'SUCCESS' ? 'paid' : `${o.status}: ${o.contractCodes.map((c) => `${CONSUMER_ERRORS[c] ?? `error ${c}`} (contract error ${c})`).join('; ') || 'no error code found'}`;

async function main(): Promise<void> {
  const network = await assertTestnet();
  log(`Testnet, protocol ${network.protocolVersion}`);

  const [owner, alice, bob, carol, dave] = Array.from({ length: 5 }, () => Keypair.random()) as [Keypair, Keypair, Keypair, Keypair, Keypair];
  const stranger = Keypair.random(); // never funded: an account that does not exist on the network
  log('funding five throwaway accounts with friendbot');
  await Promise.all([owner, alice, bob, carol, dave].map((k) => fund(k.publicKey())));
  await sleep(6000);

  // ---- the real collection
  const nftWasm = readFileSync(NFT_WASM);
  const policyWasm = readFileSync(resolve(WASM_DIR, 'access_policy.wasm'));
  const onChainPolicy = Buffer.from(await server.getContractWasmByContractId(POLICY_CONTRACT));
  record('the policy contract is the public deployment, holding this repository\'s build', 'reading', 'identical', onChainPolicy.equals(policyWasm) ? 'identical' : 'DIFFERENT');

  log('deploying the OpenZeppelin collection');
  const nft = await deployWasm(owner, nftWasm, [str('https://example.invalid/sorogate-test/'), str('Sorogate Test Collection'), str('SGTC'), addr(owner.publicKey())]);
  const nftOnChain = Buffer.from(await server.getContractWasmByContractId(nft.contractId));
  record('the collection on the network is the WASM that was built', 'reading', 'identical', nftOnChain.equals(nftWasm) ? 'identical' : 'DIFFERENT');

  const ctx: CallContext = { rpc: server, networkPassphrase: Networks.TESTNET, source: owner.publicKey() };
  const mint = async (to: Keypair) => invoke(owner, nft.contractId, 'mint', [addr(to.publicKey())]);

  // ---- what balance(owner) really returns
  const before = await simulateRaw(owner.publicKey(), nft.contractId, 'balance', [addr(alice.publicKey())]);
  record('balance(owner) of a collection, before anything is minted: the XDR type', 'simulation', 'scvU32', 'value' in before ? before.value.type : `error: ${before.error.split('\n')[0]}`);
  record('and its value', 'simulation', '0', 'value' in before ? String(scValToNative(before.value)) : 'error');

  const aliceFirst = await mint(alice);
  const aliceSecond = await mint(alice);
  const bobFirst = await mint(bob);
  const ids = [aliceFirst, aliceSecond, bobFirst].map((m) => Number(scValToNative(m.returnValue as xdr.ScVal)));
  record('three tokens are minted: two to alice, one to bob (token ids)', 'transaction', '0,1,2', ids.join(','), `${aliceFirst.hash} ${aliceSecond.hash} ${bobFirst.hash}`);
  const ownerOf0 = await simulateRaw(owner.publicKey(), nft.contractId, 'owner_of', [nativeToScVal(0, { type: 'u32' })]);
  record('owner_of(0) is alice', 'simulation', alice.publicKey(), 'value' in ownerOf0 ? String(scValToNative(ownerOf0.value)) : 'error');

  const holds = async (who: string): Promise<string> => {
    const r = await simulateRaw(owner.publicKey(), nft.contractId, 'balance', [addr(who)]);
    return 'value' in r ? `${r.value.type} ${scValToNative(r.value)}` : 'error';
  };
  record('balance(alice)', 'simulation', 'scvU32 2', await holds(alice.publicKey()));
  record('balance(bob)', 'simulation', 'scvU32 1', await holds(bob.publicKey()));
  record('balance(carol), who owns none', 'simulation', 'scvU32 0', await holds(carol.publicKey()));
  record('balance of an account that does not exist on the network', 'simulation', 'scvU32 0', await holds(stranger.publicKey()));

  // ---- policies over the real collection
  const nftPolicy = (min: number): Condition[] => [{ type: 'nft_balance', collection: nft.contractId, min }];
  const makePolicy = async (conditions: Condition[]): Promise<bigint> =>
    scValToNative((await invoke(owner, POLICY_CONTRACT, 'create', [addr(owner.publicKey()), encodeConditions(conditions)])).returnValue as xdr.ScVal) as bigint;
  const atLeastOne = await makePolicy(nftPolicy(1));
  const atLeastTwo = await makePolicy(nftPolicy(2));
  log(`policies on the public contract: ${atLeastOne} (at least 1) and ${atLeastTwo} (at least 2)`);

  const subjects: [string, Keypair][] = [['alice (2)', alice], ['bob (1)', bob], ['carol (0)', carol], ['an account that does not exist', stranger]];
  const compare = async (label: string, policyId: bigint, who: Keypair, expected: string): Promise<void> => {
    const onChain = await evaluateOnChain(ctx, { contractId: POLICY_CONTRACT, policyId, subject: who.publicKey() });
    const { policy } = await getPolicy(ctx, { contractId: POLICY_CONTRACT, policyId });
    const { snapshot } = await fetchSnapshot(ctx, { conditions: policy.conditions, subject: who.publicKey() });
    const model: Decision = evaluate(policy, snapshot);
    const same = jsonOf(model) === jsonOf(onChain.decision);
    const name = onChain.decision.allowed ? 'allowed' : `denied (${onChain.decision.reason})`;
    record(`${label}: the contract says ${expected}, and the model agrees`, 'simulation', `${expected}; model agrees`, `${name}; ${same ? 'model agrees' : `model says ${jsonOf(model)}`}`);
  };

  log('--- the contract and the model, over the real collection');
  for (const [name, who] of subjects) {
    const expected = name.startsWith('alice') || name.startsWith('bob') ? 'allowed' : 'denied (BelowMinimum)';
    await compare(`at least 1, ${name}`, atLeastOne, who, expected);
  }
  await compare('at least 2, alice (2)', atLeastTwo, alice, 'allowed');
  await compare('at least 2, bob (1)', atLeastTwo, bob, 'denied (BelowMinimum)');

  log('--- a token moves: alice sends token 0 to carol');
  const transfer = await invoke(alice, nft.contractId, 'transfer', [addr(alice.publicKey()), addr(carol.publicKey()), nativeToScVal(0, { type: 'u32' })]);
  record('alice transfers token 0 to carol', 'transaction', 'done', 'done', transfer.hash);
  await compare('at least 1, carol (now 1)', atLeastOne, carol, 'allowed');
  await compare('at least 2, alice (now 1)', atLeastTwo, alice, 'denied (BelowMinimum)');
  await compare('at least 1, alice (now 1)', atLeastOne, alice, 'allowed');

  // ---- the failure behaviour on a real contract: an NftBalance condition over something that is not a collection
  log('--- an NftBalance condition over a fungible token');
  const asset = new Asset('SGN', owner.publicKey());
  const sacResult = await submit(owner, Operation.createStellarAssetContract({ asset }), true);
  const reward = scValToNative(sacResult.returnValue as xdr.ScVal) as string;
  for (const who of [alice, bob, carol, dave]) await submit(who, Operation.changeTrust({ asset }), false);
  const wrongKind = await makePolicy([{ type: 'nft_balance', collection: reward, min: 1 }]);
  const sacBalance = await simulateRaw(owner.publicKey(), reward, 'balance', [addr(alice.publicKey())]);
  record('the fungible token answers balance with an i128, not a u32', 'simulation', 'scvI128', 'value' in sacBalance ? sacBalance.value.type : 'error');
  await compare('an NftBalance condition over that fungible token, alice', wrongKind, alice, 'denied (BalanceUnavailable)');

  // ---- the consumer
  log('--- the reference consumer, against an NFT policy');
  const consumerWasm = readFileSync(resolve(WASM_DIR, 'gated_claim.wasm'));
  const consumer = await deployWasm(owner, consumerWasm, [addr(POLICY_CONTRACT), u64ToScVal(atLeastOne), addr(reward), i128(AMOUNT), xdr.ScVal.scvVoid()]);
  await invoke(owner, reward, 'transfer', [addr(owner.publicKey()), addr(consumer.contractId), i128(POOL)]);
  const rewardOf = async (who: string): Promise<string> => {
    const { reading } = await readBalance(ctx, { kind: 'token', address: reward, subject: who });
    return reading.status === 'ok' ? `${reading.value / STROOPS} SGN` : 'unavailable';
  };
  const claim = (who: Keypair) => invoke(who, consumer.contractId, 'claim', [addr(who.publicKey())]);

  const carolClaim = await claim(carol);
  record('carol, who holds one token, claims on the consumer', 'transaction', 'paid', 'paid', carolClaim.hash);
  record('carol now holds the reward', 'reading', '10 SGN', await rewardOf(carol.publicKey()));

  log('bob signs a claim while he owns his token; he then gives the token away; the claim is sent afterwards');
  const bobAccount = await server.getAccount(bob.publicKey());
  // Bob's transfer below is his next transaction and takes the next sequence number, so the claim must take the one after it.
  bobAccount.incrementSequenceNumber();
  const bobClaim = await prepareClaim(consumer.contractId, bob, bobAccount, bob.publicKey());
  const giveAway = await invoke(bob, nft.contractId, 'transfer', [addr(bob.publicKey()), addr(dave.publicKey()), nativeToScVal(2, { type: 'u32' })]);
  record('bob transfers token 2 to dave', 'transaction', 'done', 'done', giveAway.hash);
  const refused = await sendAndWatch(bobClaim);
  record("bob's claim, signed while he owned the token, is sent after he no longer does", 'transaction', 'FAILED: BelowMinimum (contract error 11)', describe(refused), refused.hash);
  record('bob was not paid', 'reading', '0 SGN', await rewardOf(bob.publicKey()));
  const daveClaim = await claim(dave);
  record('dave, who now holds the token, claims', 'transaction', 'paid', 'paid', daveClaim.hash);
  record('the consumer paid two claims', 'reading', '80 SGN', await (async () => {
    const { reading } = await readBalance(ctx, { kind: 'token', address: reward, subject: consumer.contractId });
    return reading.status === 'ok' ? `${reading.value / STROOPS} SGN` : 'unavailable';
  })());

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
    collection: {
      contract: nft.contractId,
      source: NFT_SOURCE,
      wasmBytes: nftWasm.length,
      wasmSha256: createHash('sha256').update(nftWasm).digest('hex'),
      balanceReturnType: 'value' in before ? before.value.type : 'unknown',
    },
    policyContract: POLICY_CONTRACT,
    policies: { atLeastOne: String(atLeastOne), atLeastTwo: String(atLeastTwo), nftConditionOverFungibleToken: String(wrongKind) },
    contracts: { consumer: consumer.contractId, consumerWasmSha256: consumer.wasmSha256, rewardAssetContract: reward },
    accounts: Object.fromEntries(
      Object.entries({ collectionOwnerAndPolicyOwner: owner, alice, bob, carol, dave, nonexistentAccount: stranger }).map(([name, key]) => [name, key.publicKey()]),
    ),
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
