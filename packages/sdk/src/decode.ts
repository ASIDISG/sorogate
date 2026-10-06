import { scValToNative, type xdr } from '@stellar/stellar-sdk';

import type { Reading } from './types.js';

const unavailable: Reading = { status: 'unavailable' };

/**
 * Reads the return value of a token's `balance(Address)` the way the contract does: only an `i128` counts
 * (SEP-41). Anything else (another integer width, a non-number, no value because the call failed) is
 * `unavailable`, never a guess.
 */
export function decodeTokenBalance(returnValue: xdr.ScVal | null | undefined): Reading {
  if (returnValue?.type !== 'scvI128') return unavailable;
  return { status: 'ok', value: scValToNative(returnValue) as bigint };
}

/**
 * Reads the return value of a collection's `balance(Address)` the way the contract does: only a `u32` counts
 * (what OpenZeppelin's SEP-50 implementation returns). A wider type, such as `u64` or `i128`, is `unavailable`.
 */
export function decodeNftBalance(returnValue: xdr.ScVal | null | undefined): Reading {
  if (returnValue?.type !== 'scvU32') return unavailable;
  return { status: 'ok', value: BigInt(scValToNative(returnValue) as number) };
}
