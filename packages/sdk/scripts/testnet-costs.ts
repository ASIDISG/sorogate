/**
 * Measures what Sorogate's calls cost on Stellar Testnet: `evaluate` for policies of 1, 2, 3 and 8 conditions of each
 * type, over real contracts (Stellar asset contracts, OpenZeppelin's fungible token and NFT collection), plus `create`
 * and a consumer's `claim`.
 *
 *   tsx scripts/testnet-costs.ts --wasm-dir <dir with access_policy.wasm and gated_claim.wasm> \
 *       --ft-wasm <fungible token wasm> --nft-wasm <nft wasm> --sources <text> --report report.json
 *
 * Each case is measured twice. **Fresh** is right after deployment. **Settled** is after one applied transaction has
 * gone through every contract involved. The two differ because a token may extend the lifetime of its own entries when it
 * is called, and the rent for that is part of the simulated fee; the contracts a run has just deployed are below the
 * threshold at which that happens, and a long-lived contract mostly is not.
 *
 * Every number comes from the network's own `simulateTransaction` response: the instructions the transaction would
 * declare, the minimum resource fee in stroops, and the footprint (the ledger entries read and written). The limits
 * are read from the network's configuration. Nothing is applied by the measurements themselves.
 *
 * To measure the worst case of eight conditions over eight *different* contract codes, the script deploys each real
 * WASM eight times with a different empty custom section appended, so every copy has its own hash and is loaded
 * separately. A custom section is data the WebAssembly format sets aside for tools; it does not change what the
 * contract does. The instances that share one code are measured as well, for comparison.
 *
 * Throwaway keys (in memory only, never printed or saved). It uses its own copy of the policy contract (the same WASM as
 * the public deployment), so it does not add policies to the public one. Not part of CI.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Address, Asset, Contract, Keypair, nativeToScVal, Networks, Operation, rpc, scValToNative, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

import { encodeConditions, u64ToScVal, type Condition } from '../src/index.js';
import { assertTestnet, deployInstance, deployWasm, fund, invoke, log, server, sleep, submit } from './testnet-lib.js';

const arg = (name: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
};
const WASM_DIR = resolve(arg('wasm-dir'));
const FT_WASM = resolve(arg('ft-wasm'));
const NFT_WASM = resolve(arg('nft-wasm'));
const SOURCES = arg('sources');
const REPORT = resolve(arg('report'));
const REPEATS = 3;

const addr = (a: string) => new Address(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const str = (s: string) => nativeToScVal(s, { type: 'string' });
const jsonOf = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v));
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

function leb128(n: number): number[] {
  const out: number[] = [];
  let value = n;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    out.push(byte);
  } while (value !== 0);
  return out;
}
/** The same contract with an empty custom section appended, so it has a different hash and is loaded on its own. */
function variantOf(wasm: Buffer, tag: string): Buffer {
  const name = Buffer.from('sorogate-cost-variant');
  const payload = Buffer.concat([Buffer.from(leb128(name.length)), name, Buffer.from(tag)]);
  return Buffer.concat([wasm, Buffer.from([0x00]), Buffer.from(leb128(payload.length)), payload]);
}

// ---------------------------------------------------------------- measuring

interface Resources {
  instructions: number;
  minResourceFeeStroops: number;
  diskReadBytes: number;
  writeBytes: number;
  footprint: { readOnly: number; readWrite: number; contractData: number; contractCode: number };
}

async function measureOnce(source: string, contractId: string, method: string, args: xdr.ScVal[]): Promise<{ resources: Resources; result: unknown }> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const response = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(response)) throw new Error(`simulation of ${method} failed: ${String(response.error).split('\n')[0]}`);
  const ok = response as rpc.Api.SimulateTransactionSuccessResponse;
  const data = JSON.parse(jsonOf(ok.transactionData?.build())) as {
    resources: { footprint: { read_only: Record<string, unknown>[]; read_write: Record<string, unknown>[] }; instructions: number; disk_read_bytes: number; write_bytes: number };
  };
  const entries = [...data.resources.footprint.read_only, ...data.resources.footprint.read_write];
  return {
    resources: {
      instructions: data.resources.instructions,
      minResourceFeeStroops: Number(ok.minResourceFee),
      diskReadBytes: data.resources.disk_read_bytes,
      writeBytes: data.resources.write_bytes,
      footprint: {
        readOnly: data.resources.footprint.read_only.length,
        readWrite: data.resources.footprint.read_write.length,
        contractData: entries.filter((e) => 'contract_data' in e).length,
        contractCode: entries.filter((e) => 'contract_code' in e).length,
      },
    },
    result: ok.result?.retval === undefined ? undefined : scValToNative(ok.result.retval),
  };
}

interface Range {
  min: number;
  max: number;
}
const range = (xs: number[]): Range => ({ min: Math.min(...xs), max: Math.max(...xs) });

interface Measured {
  instructions: Range;
  minResourceFeeStroops: Range;
  diskReadBytes: Range;
  writeBytes: Range;
  footprint: Resources['footprint'];
  result: unknown;
}
async function measure(source: string, contractId: string, method: string, args: xdr.ScVal[]): Promise<Measured> {
  const runs = [];
  for (let i = 0; i < REPEATS; i++) runs.push(await measureOnce(source, contractId, method, args));
  const first = runs[0] as (typeof runs)[number];
  return {
    instructions: range(runs.map((r) => r.resources.instructions)),
    minResourceFeeStroops: range(runs.map((r) => r.resources.minResourceFeeStroops)),
    diskReadBytes: range(runs.map((r) => r.resources.diskReadBytes)),
    writeBytes: range(runs.map((r) => r.resources.writeBytes)),
    footprint: first.resources.footprint,
    result: first.result,
  };
}

async function networkLimits(): Promise<Record<string, unknown>> {
  const read = async (name: string): Promise<Record<string, unknown>> => {
    const id = xdr.ConfigSettingId.fromName(`configSetting${name}` as never);
    const res = await server.getLedgerEntries(xdr.LedgerKey.configSetting(new xdr.LedgerKeyConfigSetting({ configSettingId: id })));
    return (JSON.parse(jsonOf(res.entries[0]?.val)) as { config_setting: Record<string, unknown> }).config_setting;
  };
  return {
    compute: (await read('ContractComputeV0')).contract_compute_v0,
    ledgerCost: (await read('ContractLedgerCostV0')).contract_ledger_cost_v0,
    footprint: (await read('ContractLedgerCostExtV0')).contract_ledger_cost_ext_v0,
    maxContractSizeBytes: (await read('ContractMaxSizeBytes')).contract_max_size_bytes,
    stateArchival: (await read('StateArchival')).state_archival,
  };
}

// ---------------------------------------------------------------- the run

type Kind = 'time' | 'sac' | 'ft' | 'ftSameCode' | 'nft';
interface Case {
  name: string;
  kind: Kind | 'mixed' | 'ftRepeated';
  conditions: number;
  distinctContracts: number;
  distinctCodes: number;
  allowed: boolean;
  policyId: string;
  /** Measured right after deployment, before any transaction has touched the contracts. */
  fresh: Measured;
  /** Measured after one applied transaction has touched every contract involved. */
  settled?: Measured;
}

async function main(): Promise<void> {
  const network = await assertTestnet();
  log(`Testnet, protocol ${network.protocolVersion}`);
  const limits = await networkLimits();
  log(`limits: ${jsonOf(limits).slice(0, 200)}…`);

  const owner = Keypair.random();
  const subject = Keypair.random();
  const sacOwner = Keypair.random();
  const ftOwner = Keypair.random();
  const sameOwner = Keypair.random();
  const nftOwner = Keypair.random();
  const everyone = [owner, subject, sacOwner, ftOwner, sameOwner, nftOwner];
  log('funding six throwaway accounts');
  await Promise.all(everyone.map((k) => fund(k.publicKey())));
  await sleep(6000);

  const read = (name: string) => readFileSync(resolve(WASM_DIR, name));
  const policyWasm = read('access_policy.wasm');
  const consumerWasm = read('gated_claim.wasm');
  const ftWasm = readFileSync(FT_WASM);
  const nftWasm = readFileSync(NFT_WASM);

  log('deploying a policy contract of its own (the same WASM as the public deployment)');
  const policy = await deployWasm(owner, policyWasm, []);

  // ---- eight of each real contract kind, in parallel, each kind from its own account
  const N = 8;
  const asset = (i: number, issuer: Keypair) => new Asset(`SGC${i}`, issuer.publicKey());

  log('deploying: 8 asset contracts, 8 fungible tokens (distinct code), 8 fungible tokens (shared code), 8 NFT collections (distinct code)');
  const [sacs, fts, ftsSame, nfts, reward] = await Promise.all([
    (async () => {
      const ids: string[] = [];
      for (let i = 0; i < N; i++) {
        const r = await submit(sacOwner, Operation.createStellarAssetContract({ asset: asset(i, sacOwner) }), true);
        ids.push(scValToNative(r.returnValue as xdr.ScVal) as string);
      }
      return ids;
    })(),
    (async () => {
      const ids: string[] = [];
      for (let i = 0; i < N; i++) {
        const d = await deployWasm(ftOwner, variantOf(ftWasm, `ft-${i}`), [str('Cost Token'), str('CST'), addr(ftOwner.publicKey()), i128(0n)]);
        await invoke(ftOwner, d.contractId, 'mint', [addr(subject.publicKey()), i128(1_000_000_000_000_000_000n)]);
        ids.push(d.contractId);
      }
      return ids;
    })(),
    (async () => {
      const first = await deployWasm(sameOwner, ftWasm, [str('Cost Token'), str('CST'), addr(sameOwner.publicKey()), i128(0n)]);
      const ids = [first.contractId];
      for (let i = 1; i < N; i++) ids.push(await deployInstance(sameOwner, first.wasmSha256, [str('Cost Token'), str('CST'), addr(sameOwner.publicKey()), i128(0n)]));
      for (const id of ids) await invoke(sameOwner, id, 'mint', [addr(subject.publicKey()), i128(1_000_000_000_000_000_000n)]);
      return ids;
    })(),
    (async () => {
      const ids: string[] = [];
      for (let i = 0; i < N; i++) {
        const d = await deployWasm(nftOwner, variantOf(nftWasm, `nft-${i}`), [str('https://example.invalid/'), str('Cost Collection'), str('CCL'), addr(nftOwner.publicKey())]);
        await invoke(nftOwner, d.contractId, 'mint', [addr(subject.publicKey())]);
        ids.push(d.contractId);
      }
      return ids;
    })(),
    (async () => {
      const rewardAsset = new Asset('SGR', owner.publicKey());
      const r = await submit(owner, Operation.createStellarAssetContract({ asset: rewardAsset }), true);
      return scValToNative(r.returnValue as xdr.ScVal) as string;
    })(),
  ]);

  log('trustlines for the subject, then paying it in each asset');
  for (let i = 0; i < N; i++) await submit(subject, Operation.changeTrust({ asset: asset(i, sacOwner) }), false);
  await submit(subject, Operation.changeTrust({ asset: new Asset('SGR', owner.publicKey()) }), false);
  for (const id of sacs) await invoke(sacOwner, id, 'transfer', [addr(sacOwner.publicKey()), addr(subject.publicKey()), i128(1_000_000_000n)]);

  // ---- policies and their measurements
  const tokenCond = (token: string): Condition => ({ type: 'token_balance', token, min: 1n });
  const nftCond = (collection: string): Condition => ({ type: 'nft_balance', collection, min: 1 });
  const window = (i: number): Condition => ({ type: 'time_window', notBefore: BigInt(1 + i), notAfter: null });

  const makePolicy = async (conditions: Condition[]): Promise<bigint> =>
    scValToNative((await invoke(owner, policy.contractId, 'create', [addr(owner.publicKey()), encodeConditions(conditions)])).returnValue as xdr.ScVal) as bigint;

  const cases: Case[] = [];
  const caseOf = async (name: string, kind: Case['kind'], conditions: Condition[], distinctContracts: number, distinctCodes: number): Promise<void> => {
    const id = await makePolicy(conditions);
    const fresh = await measure(subject.publicKey(), policy.contractId, 'evaluate', [u64ToScVal(id), addr(subject.publicKey())]);
    const allowed = (fresh.result as { allowed: boolean }).allowed;
    cases.push({ name, kind, conditions: conditions.length, distinctContracts, distinctCodes, allowed, policyId: String(id), fresh });
    log(`${name}: ${fresh.instructions.min} instructions, fresh fee ${fresh.minResourceFeeStroops.min}, ${fresh.footprint.readOnly} read-only entries, allowed=${allowed}`);
  };

  log('--- measuring evaluate');
  for (const n of [1, 2, 3, 8]) await caseOf(`${n} time window${n > 1 ? 's' : ''}`, 'time', Array.from({ length: n }, (_, i) => window(i)), 0, 0);
  for (const n of [1, 2, 3, 8]) await caseOf(`${n} asset contract${n > 1 ? 's' : ''} (TokenBalance)`, 'sac', sacs.slice(0, n).map(tokenCond), n, 0);
  for (const n of [1, 2, 3, 8]) await caseOf(`${n} fungible token${n > 1 ? 's' : ''}, each its own code (TokenBalance)`, 'ft', fts.slice(0, n).map(tokenCond), n, n);
  for (const n of [1, 2, 3, 8]) await caseOf(`${n} NFT collection${n > 1 ? 's' : ''}, each its own code (NftBalance)`, 'nft', nfts.slice(0, n).map(nftCond), n, n);
  await caseOf('8 fungible tokens that share one code (TokenBalance)', 'ftSameCode', ftsSame.map(tokenCond), 8, 1);
  await caseOf('8 conditions naming the same fungible token', 'ftRepeated', Array.from({ length: 8 }, () => tokenCond(fts[0] as string)), 1, 1);
  await caseOf('3 mixed: window, asset contract, NFT collection', 'mixed', [window(0), tokenCond(sacs[0] as string), nftCond(nfts[0] as string)], 2, 1);
  await caseOf(
    '8 mixed: 2 windows, 2 asset contracts, 2 fungible tokens, 2 NFT collections',
    'mixed',
    [window(0), window(1), tokenCond(sacs[0] as string), tokenCond(sacs[1] as string), tokenCond(fts[0] as string), tokenCond(fts[1] as string), nftCond(nfts[0] as string), nftCond(nfts[1] as string)],
    6,
    4,
  );
  // The first condition fails, so the rest are never read: evaluation stops at the first failure.
  const earlyId = await makePolicy([{ type: 'token_balance', token: (fts[0] as string), min: 1n << 100n }, ...fts.slice(1).map(tokenCond)]);
  const early = await measure(subject.publicKey(), policy.contractId, 'evaluate', [u64ToScVal(earlyId), addr(subject.publicKey())]);
  cases.push({
    name: '8 fungible tokens, the first condition fails (stops there)',
    kind: 'ft',
    conditions: 8,
    distinctContracts: 8,
    distinctCodes: 8,
    allowed: (early.result as { allowed: boolean }).allowed,
    policyId: String(earlyId),
    fresh: early,
  });
  log(`early exit: ${early.instructions.min} instructions, allowed=${(early.result as { allowed: boolean }).allowed}`);

  // ---- a single call to each kind of contract, by itself
  interface Direct {
    name: string;
    contract: string;
    fresh: Measured;
    settled?: Measured;
  }
  const directs: Direct[] = [];
  const subjectArg = [addr(subject.publicKey())];
  const directTargets: [string, string][] = [
    ['OpenZeppelin fungible token, balance(holder)', fts[0] as string],
    ['OpenZeppelin NFT collection, balance(holder)', nfts[0] as string],
    ['asset contract, balance(holder)', sacs[0] as string],
  ];
  for (const [name, contract] of directTargets) {
    directs.push({ name, contract, fresh: await measure(subject.publicKey(), contract, 'balance', subjectArg) });
  }
  directs.push({
    name: 'OpenZeppelin fungible token, balance(an account with no entry)',
    contract: fts[0] as string,
    fresh: await measure(subject.publicKey(), fts[0] as string, 'balance', [addr(owner.publicKey())]),
  });

  // ---- create, and a consumer's claim
  log('--- measuring create');
  const creates: { name: string; conditions: number; measured: Measured }[] = [];
  for (const n of [1, 3, 8]) {
    const measured = await measure(owner.publicKey(), policy.contractId, 'create', [addr(owner.publicKey()), encodeConditions(fts.slice(0, n).map(tokenCond))]);
    creates.push({ name: `create, ${n} fungible token condition${n > 1 ? 's' : ''}`, conditions: n, measured });
    log(`create ${n}: ${measured.instructions.min} instructions, fee ${measured.minResourceFeeStroops.min}`);
  }

  log('--- measuring a consumer claim');
  const claims: { name: string; conditions: number; consumer: string; fresh: Measured; settled?: Measured }[] = [];
  for (const n of [1, 8]) {
    const id = await makePolicy(fts.slice(0, n).map(tokenCond));
    const consumer = await deployWasm(owner, consumerWasm, [addr(policy.contractId), u64ToScVal(id), addr(reward), i128(10_000_000n), xdr.ScVal.scvVoid()]);
    await invoke(owner, reward, 'transfer', [addr(owner.publicKey()), addr(consumer.contractId), i128(1_000_000_000n)]);
    const fresh = await measure(subject.publicKey(), consumer.contractId, 'claim', [addr(subject.publicKey())]);
    claims.push({ name: `claim, policy of ${n} fungible token condition${n > 1 ? 's' : ''}`, conditions: n, consumer: consumer.contractId, fresh });
    log(`claim ${n}: ${fresh.instructions.min} instructions, fresh fee ${fresh.minResourceFeeStroops.min}`);
  }

  // ---- settle: one applied transaction through every contract involved, then measure everything again.
  // A token may extend the lifetime of its own entries when it is called, and the rent for that is part of the
  // simulated fee. It is paid when the lifetime is below the token's threshold, which is the case just after deployment.
  log('--- settling: applying one real evaluate through every group of contracts');
  const idOf = (name: string): string => (cases.find((c) => c.name === name) as Case).policyId;
  for (const name of [
    '8 asset contracts (TokenBalance)',
    '8 fungible tokens, each its own code (TokenBalance)',
    '8 NFT collections, each its own code (NftBalance)',
    '8 fungible tokens that share one code (TokenBalance)',
  ]) {
    await invoke(subject, policy.contractId, 'evaluate', [u64ToScVal(BigInt(idOf(name))), addr(subject.publicKey())]);
  }
  await sleep(6000);

  log('--- measuring again, settled');
  for (const c of cases) c.settled = await measure(subject.publicKey(), policy.contractId, 'evaluate', [u64ToScVal(BigInt(c.policyId)), addr(subject.publicKey())]);
  for (const d of directs) {
    const args = d.name.includes('no entry') ? [addr(owner.publicKey())] : subjectArg;
    d.settled = await measure(subject.publicKey(), d.contract, 'balance', args);
  }
  for (const c of claims) c.settled = await measure(subject.publicKey(), c.consumer, 'claim', [addr(subject.publicKey())]);
  for (const c of cases) log(`${c.name}: fresh fee ${c.fresh.minResourceFeeStroops.min}, settled fee ${(c.settled as Measured).minResourceFeeStroops.min}`);

  const latest = await server.getLatestLedger();
  const report = {
    label: 'Recorded',
    network: `Stellar Testnet (protocol ${network.protocolVersion})`,
    ranAt: new Date().toISOString(),
    ledger: latest.sequence,
    repeatsPerMeasurement: REPEATS,
    limits,
    contracts: {
      policyContract: policy.contractId,
      policyWasmSha256: policy.wasmSha256,
      fungibleToken: { wasmBytes: ftWasm.length, wasmSha256: sha256(ftWasm), instancesWithDistinctCode: fts, instancesSharingOneCode: ftsSame },
      nftCollection: { wasmBytes: nftWasm.length, wasmSha256: sha256(nftWasm), instancesWithDistinctCode: nfts },
      assetContracts: sacs,
      rewardAssetContract: reward,
      sources: SOURCES,
    },
    cases,
    directCalls: directs,
    creates,
    claims,
  };
  writeFileSync(REPORT, JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
  console.log(`\nwrote ${REPORT}: ${cases.length} evaluate cases, ${creates.length} create, ${claims.length} claim.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
