import { Address, Keypair, nativeToScVal, StrKey, xdr } from '@stellar/stellar-sdk';

import { encodeConditions, type Condition } from '../src/index.js';

const sym = (s: string) => xdr.ScVal.scvSymbol(s);

export const contractId = (byte: number): string => StrKey.encodeContract(Buffer.alloc(32, byte));
export const accountId = (): string => Keypair.random().publicKey();

/** Builds a struct the way the contract returns one: keys in alphabetical order. */
export const structOf = (fields: Record<string, xdr.ScVal>): xdr.ScVal =>
  xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: sym(k), val: fields[k] as xdr.ScVal })),
  );

export const decisionScVal = (d: { allowed: boolean; version: number; failedIndex: number | null; reason: number }): xdr.ScVal =>
  structOf({
    allowed: xdr.ScVal.scvBool(d.allowed),
    failed_index: d.failedIndex === null ? xdr.ScVal.scvVoid() : nativeToScVal(d.failedIndex, { type: 'u32' }),
    reason: nativeToScVal(d.reason, { type: 'u32' }),
    version: nativeToScVal(d.version, { type: 'u32' }),
  });

/** A stored policy as the contract returns it from `get`. */
export const policyScVal = (
  conditions: Condition[],
  options: { owner?: string; version?: number; active?: boolean } = {},
): xdr.ScVal =>
  structOf({
    active: xdr.ScVal.scvBool(options.active ?? true),
    conditions: encodeConditions(conditions),
    owner: new Address(options.owner ?? accountId()).toScVal(),
    version: nativeToScVal(options.version ?? 1, { type: 'u32' }),
  });
