/**
 * The public Testnet deployment of the policy contract: create it, check it, keep it alive.
 *
 *   tsx scripts/testnet-deployment.ts deploy --wasm <access_policy.wasm> --out <deployment.json> --commit <git sha> --built-with <text>
 *   tsx scripts/testnet-deployment.ts verify --contract <C...> --wasm <access_policy.wasm>
 *   tsx scripts/testnet-deployment.ts extend --contract <C...>
 *
 * `deploy` uses a throwaway key that exists only in memory: it is never printed or saved. That is enough because the
 * policy contract has no administrator, owner or upgrade path, so the account that deploys it has no power over it
 * afterwards. It uploads the WASM, creates one instance, fetches the code back from the network and compares it with
 * the local file byte for byte, extends the lifetime of the instance and the code, and checks the contract answers.
 *
 * `verify` needs no key and sends nothing: it reads the code the network holds for a contract and compares its hash
 * with a local build. `extend` funds a fresh throwaway account to extend the lifetime of a contract that is already
 * deployed; anyone can do that for any contract.
 *
 * Every script here refuses to run unless the network reports the Testnet passphrase.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Contract,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import { ContractCallError, getPolicy, type CallContext } from '../src/client.js';
import { assertTestnet, deployWasm, fund, log, RPC_URL, server, sleep } from './testnet-lib.js';

const SECONDS_PER_LEDGER = 5;

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const required = (name: string): string => {
  const value = flag(name);
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
};
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function codeKey(wasmHash: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmHash, 'hex') }));
}

/** When the instance and the code of a contract will be archived, as ledger numbers. */
async function liveUntil(contractId: string, wasmHash: string): Promise<{ latestLedger: number; instance: number; code: number }> {
  const response = await server.getLedgerEntries(new Contract(contractId).getFootprint(), codeKey(wasmHash));
  const [instance, code] = response.entries;
  if (instance?.liveUntilLedgerSeq === undefined || code?.liveUntilLedgerSeq === undefined) {
    throw new Error('the network does not hold the contract instance and its code (archived or never deployed)');
  }
  return { latestLedger: response.latestLedger, instance: instance.liveUntilLedgerSeq, code: code.liveUntilLedgerSeq };
}

/** Extends the lifetime of a contract's instance and code as far as the network allows, trying shorter extensions if refused. */
async function extendLifetime(payer: Keypair, contractId: string, wasmHash: string): Promise<void> {
  const readOnly = [new Contract(contractId).getFootprint(), codeKey(wasmHash)];
  let lastError: unknown;
  // The network refuses 3,110,400 (its limit is a little lower), so start just under it.
  for (const extendTo of [3_000_000, 2_000_000, 1_000_000, 500_000]) {
    try {
      const account = await server.getAccount(payer.publicKey());
      const sorobanData = new SorobanDataBuilder().setReadOnly(readOnly).build();
      let tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET, sorobanData })
        .addOperation(Operation.extendFootprintTtl({ extendTo }))
        .setTimeout(120)
        .build();
      tx = await server.prepareTransaction(tx);
      tx.sign(payer);
      const sent = await server.sendTransaction(tx);
      if (sent.status === 'ERROR') throw new Error(`rejected: ${JSON.stringify(sent.errorResult)}`);
      for (let i = 0; i < 60; i++) {
        const result = await server.getTransaction(sent.hash);
        if (result.status === 'SUCCESS') {
          log(`extended to ${extendTo} ledgers (transaction ${sent.hash})`);
          return;
        }
        if (result.status === 'FAILED') throw new Error(`failed: ${sent.hash}`);
        await sleep(1500);
      }
      throw new Error('not confirmed in time');
    } catch (error) {
      lastError = error;
      log(`extending by ${extendTo} ledgers did not work: ${error instanceof Error ? error.message.split('\n')[0] : error}`);
    }
  }
  throw lastError;
}

const describeLifetime = (l: { latestLedger: number; instance: number; code: number }) => {
  const until = Math.min(l.instance, l.code);
  const days = ((until - l.latestLedger) * SECONDS_PER_LEDGER) / 86_400;
  return {
    latestLedger: l.latestLedger,
    instanceLiveUntilLedger: l.instance,
    codeLiveUntilLedger: l.code,
    approximateDaysRemaining: Math.round(days * 10) / 10,
    estimatedArchivalDate: new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10),
  };
};

async function wasmOnChain(contractId: string): Promise<Buffer> {
  return Buffer.from(await server.getContractWasmByContractId(contractId));
}

async function deploy(): Promise<void> {
  const wasm = readFileSync(resolve(required('wasm')));
  const out = resolve(required('out'));
  const commit = required('commit');
  const builtWith = required('built-with');
  const network = await assertTestnet();
  const localHash = sha256(wasm);
  log(`Testnet, protocol ${network.protocolVersion}; local WASM ${wasm.length} bytes, sha256 ${localHash}`);

  const deployer = Keypair.random();
  log(`deployer account (public, throwaway, discarded after this run): ${deployer.publicKey()}`);
  await fund(deployer.publicKey());
  await sleep(6000);

  const runStartedAt = new Date().toISOString();
  const { contractId, wasmSha256, uploadTxHash, createTxHash, createLedger } = await deployWasm(deployer, wasm, []);
  log(`deployed ${contractId}`);
  const closedAt = async (hash: string): Promise<string> => {
    const tx = await server.getTransaction(hash);
    if (tx.status !== 'SUCCESS') throw new Error(`transaction ${hash} is not confirmed`);
    return new Date(tx.createdAt * 1000).toISOString();
  };
  const [uploadedAt, deployedAt] = [await closedAt(uploadTxHash), await closedAt(createTxHash)];
  if (wasmSha256 !== localHash) throw new Error('the uploaded hash differs from the local file');

  const onChain = await wasmOnChain(contractId);
  const onChainHash = sha256(onChain);
  if (!onChain.equals(wasm)) throw new Error(`the code the network holds (${onChainHash}) is not the local file (${localHash})`);
  log(`the network holds the same ${onChain.length} bytes`);

  await extendLifetime(deployer, contractId, localHash);
  const lifetime = describeLifetime(await liveUntil(contractId, localHash));

  // The contract answers: an unknown policy is its own error (PolicyNotFound), not a failure to reach the contract.
  const context: CallContext = { rpc: server, networkPassphrase: Networks.TESTNET, source: deployer.publicKey() };
  let answers = 'unexpected';
  try {
    await getPolicy(context, { contractId, policyId: 1n });
  } catch (error) {
    if (error instanceof ContractCallError && error.errorName === 'PolicyNotFound') answers = 'get(1) returned PolicyNotFound, as expected for a contract with no policies';
  }
  if (!answers.startsWith('get(1)')) throw new Error('the deployed contract did not answer get(1) as expected');
  log(answers);

  const record = {
    label: 'Live',
    purpose: 'Public development deployment on Stellar Testnet. Not a production deployment.',
    network: { name: 'Stellar Testnet', passphrase: Networks.TESTNET, protocolVersion: network.protocolVersion, rpc: RPC_URL },
    contract: { id: contractId, name: 'access-policy', sourcePath: 'contracts/access-policy' },
    wasm: { sha256: localHash, bytes: wasm.length, fetchedFromNetworkAndCompared: true },
    source: { commit, builtWith, note: 'The commit the WASM was built from, as stated by whoever ran the deployment. `verify` compares the network with a local build.' },
    runStartedAt,
    uploadedAt,
    deployedAt,
    timesNote: 'uploadedAt and deployedAt are the close times of the upload and creation transactions, as reported by the network. runStartedAt is when the script began.',
    deployer: {
      publicKey: deployer.publicKey(),
      note: 'A throwaway Testnet account. Its secret key was never printed or saved and has been discarded. The contract has no administrator, owner or upgrade path, so nothing depends on this account.',
    },
    transactions: { upload: uploadTxHash, create: createTxHash, createLedger },
    explorer: `https://stellar.expert/explorer/testnet/contract/${contractId}`,
    lifetime,
    check: answers,
  };
  writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
  log(`wrote ${out}`);
  console.log(`\nContract ${contractId}\nWASM sha256 ${localHash}\nKeys: the deployer's secret key was never printed or saved.`);
}

async function verify(): Promise<void> {
  const contractId = required('contract');
  const wasm = readFileSync(resolve(required('wasm')));
  await assertTestnet();
  const onChain = await wasmOnChain(contractId);
  const same = onChain.equals(wasm);
  console.log(`on the network: ${onChain.length} bytes, sha256 ${sha256(onChain)}`);
  console.log(`local file:     ${wasm.length} bytes, sha256 ${sha256(wasm)}`);
  console.log(same ? 'IDENTICAL: the deployed contract is this build.' : 'DIFFERENT: the deployed contract is not this build.');
  if (!same) process.exitCode = 1;
}

async function extend(): Promise<void> {
  const contractId = required('contract');
  await assertTestnet();
  const wasmHash = sha256(await wasmOnChain(contractId));
  const before = describeLifetime(await liveUntil(contractId, wasmHash));
  log(`before: ${JSON.stringify(before)}`);
  const payer = Keypair.random();
  await fund(payer.publicKey());
  await sleep(6000);
  await extendLifetime(payer, contractId, wasmHash);
  console.log(JSON.stringify(describeLifetime(await liveUntil(contractId, wasmHash)), null, 2));
}

const modes: Record<string, () => Promise<void>> = { deploy, verify, extend };
const mode = process.argv[2] ?? '';
(modes[mode] ?? (() => Promise.reject(new Error('usage: testnet-deployment.ts deploy|verify|extend ...'))))().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
