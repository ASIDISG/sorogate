/**
 * Conversion between this package's types and the contract's `ScVal` encoding.
 *
 * The contract's types are Soroban `contracttype`s: a struct is a map from field name to value with the keys in
 * alphabetical order, a union is a vector `[Symbol, payload]`, an integer enum is a `u32`, and an `Option` is the
 * value or void. The shapes below were checked against the deployed contract on Testnet (see the recordings under
 * `test/fixtures`).
 */
import { Address, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import {
  denyReasonFromCode,
  type Condition,
  type Decision,
  type Policy,
} from './types.js';

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

// ---------------------------------------------------------------- encoding

const symbol = (name: string): xdr.ScVal => xdr.ScVal.scvSymbol(name);

/** A struct: a map with the keys in alphabetical order, as Soroban requires. */
function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(fields)
    .sort()
    .map((key) => new xdr.ScMapEntry({ key: symbol(key), val: fields[key] as xdr.ScVal }));
  return xdr.ScVal.scvMap(entries);
}

/** `Option<u64>`: the number, or void for `None`. */
const optionalU64 = (value: bigint | null): xdr.ScVal =>
  value === null ? xdr.ScVal.scvVoid() : nativeToScVal(value, { type: 'u64' });

export const addressToScVal = (address: string): xdr.ScVal => new Address(address).toScVal();
export const u64ToScVal = (value: bigint | number): xdr.ScVal => nativeToScVal(BigInt(value), { type: 'u64' });

export function encodeCondition(condition: Condition): xdr.ScVal {
  switch (condition.type) {
    case 'token_balance':
      return xdr.ScVal.scvVec([
        symbol('TokenBalance'),
        struct({
          min: nativeToScVal(condition.min, { type: 'i128' }),
          token: addressToScVal(condition.token),
        }),
      ]);
    case 'nft_balance':
      return xdr.ScVal.scvVec([
        symbol('NftBalance'),
        struct({
          collection: addressToScVal(condition.collection),
          min: nativeToScVal(condition.min, { type: 'u32' }),
        }),
      ]);
    case 'time_window':
      return xdr.ScVal.scvVec([
        symbol('TimeWindow'),
        struct({
          not_after: optionalU64(condition.notAfter),
          not_before: optionalU64(condition.notBefore),
        }),
      ]);
  }
}

/** The argument of `create` and `update`: a vector of conditions. */
export function encodeConditions(conditions: readonly Condition[]): xdr.ScVal {
  return xdr.ScVal.scvVec(conditions.map(encodeCondition));
}

// ---------------------------------------------------------------- decoding

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new DecodeError(`${what} is not a struct`);
}

function bigint(value: unknown, what: string): bigint {
  if (typeof value === 'bigint') return value;
  throw new DecodeError(`${what} is not a 64 or 128 bit integer`);
}

function u32(value: unknown, what: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff) return value;
  throw new DecodeError(`${what} is not a u32`);
}

function text(value: unknown, what: string): string {
  if (typeof value === 'string') return value;
  throw new DecodeError(`${what} is not a string`);
}

const optionalBigint = (value: unknown, what: string): bigint | null =>
  value === null || value === undefined ? null : bigint(value, what);

function decodeConditionNative(native: unknown): Condition {
  if (!Array.isArray(native) || native.length !== 2) throw new DecodeError('a condition is not a [name, payload] pair');
  const [name, payload] = native as [unknown, unknown];
  const fields = record(payload, `the payload of ${String(name)}`);
  switch (name) {
    case 'TokenBalance':
      return { type: 'token_balance', token: text(fields.token, 'token'), min: bigint(fields.min, 'min') };
    case 'NftBalance':
      return { type: 'nft_balance', collection: text(fields.collection, 'collection'), min: u32(fields.min, 'min') };
    case 'TimeWindow':
      return {
        type: 'time_window',
        notBefore: optionalBigint(fields.not_before, 'not_before'),
        notAfter: optionalBigint(fields.not_after, 'not_after'),
      };
    default:
      throw new DecodeError(`unknown condition kind ${String(name)}`);
  }
}

/** Decodes the return value of `get`. */
export function decodePolicy(value: xdr.ScVal): Policy {
  const fields = record(scValToNative(value), 'a policy');
  if (typeof fields.active !== 'boolean') throw new DecodeError('active is not a boolean');
  if (!Array.isArray(fields.conditions)) throw new DecodeError('conditions is not a list');
  return {
    owner: text(fields.owner, 'owner'),
    version: u32(fields.version, 'version'),
    active: fields.active,
    conditions: fields.conditions.map(decodeConditionNative),
  };
}

/** Decodes the return value of `evaluate`. */
export function decodeDecision(value: xdr.ScVal): Decision {
  const fields = record(scValToNative(value), 'a decision');
  if (typeof fields.allowed !== 'boolean') throw new DecodeError('allowed is not a boolean');
  const failedIndex = fields.failed_index === null || fields.failed_index === undefined ? null : u32(fields.failed_index, 'failed_index');
  let reason;
  try {
    reason = denyReasonFromCode(u32(fields.reason, 'reason'));
  } catch (error) {
    throw error instanceof DecodeError ? error : new DecodeError((error as Error).message);
  }
  const decision: Decision = { allowed: fields.allowed, version: u32(fields.version, 'version'), failedIndex, reason };
  if (decision.allowed !== (decision.reason === 'None')) throw new DecodeError('reason is None exactly when allowed is true');
  return decision;
}
