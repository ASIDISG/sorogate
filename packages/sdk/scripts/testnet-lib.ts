/**
 * Plumbing shared by the manual Testnet scripts: funding throwaway accounts, deploying contracts, and sending
 * transactions. Nothing here runs on import. The scripts using it refuse to run unless the network reports the
 * Testnet passphrase.
 */
import { createHash, randomBytes } from 'node:crypto';

import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  type xdr,
} from '@stellar/stellar-sdk';

export const RPC_URL = process.env.SOROGATE_TESTNET_RPC ?? 'https://soroban-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';

export const server = new rpc.Server(RPC_URL);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const log = (message: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

/** Throws unless the RPC server reports Testnet, so a script can never be pointed at a real network by mistake. */
export async function assertTestnet(): Promise<{ protocolVersion: string }> {
  const network = await server.getNetwork();
  if (network.passphrase !== Networks.TESTNET) {
    throw new Error(`refusing to run: ${RPC_URL} reports "${network.passphrase}", not Testnet`);
  }
  return { protocolVersion: network.protocolVersion };
}

export async function fund(address: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT}/?addr=${address}`);
  if (!response.ok) throw new Error(`friendbot refused ${address}: ${response.status}`);
}

export async function submit(
  signer: Keypair,
  operation: xdr.Operation,
  soroban: boolean,
): Promise<rpc.Api.GetSuccessfulTransactionResponse & { hash: string }> {
  const account: Account = await server.getAccount(signer.publicKey());
  let tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET }).addOperation(operation).setTimeout(120).build();
  if (soroban) tx = await server.prepareTransaction(tx);
  tx.sign(signer);
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') throw new Error(`transaction rejected: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 60; i++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') return { ...result, hash: sent.hash };
    if (result.status === 'FAILED') throw new Error(`transaction failed: ${sent.hash}`);
    await sleep(1500);
  }
  throw new Error(`transaction not confirmed in time: ${sent.hash}`);
}

/** Uploads a WASM and deploys one instance of it. Also returns the two transactions, so a run can record them. */
export async function deployWasm(
  signer: Keypair,
  wasm: Buffer,
  constructorArgs: xdr.ScVal[],
): Promise<{ contractId: string; wasmSha256: string; uploadTxHash: string; createTxHash: string; createLedger: number }> {
  const wasmHash = createHash('sha256').update(wasm).digest();
  const upload = await submit(signer, Operation.uploadContractWasm({ wasm }), true);
  const result = await submit(
    signer,
    Operation.createCustomContract({ address: new Address(signer.publicKey()), wasmHash, salt: randomBytes(32), constructorArgs }),
    true,
  );
  return {
    contractId: scValToNative(result.returnValue as xdr.ScVal) as string,
    wasmSha256: wasmHash.toString('hex'),
    uploadTxHash: upload.hash,
    createTxHash: result.hash,
    createLedger: result.ledger,
  };
}

/** Deploys another instance of an already uploaded WASM. */
export async function deployInstance(signer: Keypair, wasmSha256: string, constructorArgs: xdr.ScVal[]): Promise<string> {
  const result = await submit(
    signer,
    Operation.createCustomContract({ address: new Address(signer.publicKey()), wasmHash: Buffer.from(wasmSha256, 'hex'), salt: randomBytes(32), constructorArgs }),
    true,
  );
  return scValToNative(result.returnValue as xdr.ScVal) as string;
}

/** Calls a contract function in a real, signed transaction. */
export async function invoke(signer: Keypair, contractId: string, method: string, args: xdr.ScVal[]): Promise<{ returnValue: xdr.ScVal | undefined; hash: string }> {
  const result = await submit(signer, new Contract(contractId).call(method, ...args), true);
  return { returnValue: result.returnValue, hash: result.hash };
}

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
export function variantOf(wasm: Buffer, tag: string): Buffer {
  const name = Buffer.from('sorogate-cost-variant');
  const payload = Buffer.concat([Buffer.from(leb128(name.length)), name, Buffer.from(tag)]);
  return Buffer.concat([wasm, Buffer.from([0x00]), Buffer.from(leb128(payload.length)), payload]);
}
