/**
 * Types mirroring the contract in `contracts/access-policy`. The rules they follow are in
 * `spec/SPEC.md`; where this file and the spec disagree, the spec wins.
 */

/** Most conditions one policy may hold. */
export const MAX_CONDITIONS = 8;

/** Integer codes of `DenyReason` as encoded by the contract. */
export const DENY_REASON_CODES = {
  None: 0,
  Inactive: 1,
  BelowMinimum: 2,
  BalanceUnavailable: 3,
  BeforeWindow: 4,
  AfterWindow: 5,
} as const;

export type DenyReason = keyof typeof DENY_REASON_CODES;

/** Codes of the contract's errors. */
export const CONTRACT_ERROR_CODES = {
  PolicyNotFound: 1,
  NoConditions: 2,
  TooManyConditions: 3,
  InvalidMinimum: 4,
  InvalidTimeWindow: 5,
  NotAContract: 6,
} as const;

export type ContractErrorName = keyof typeof CONTRACT_ERROR_CODES;

/** Holds at least `min` of a SEP-41 style token (`balance(Address) -> i128`), in base units. */
export interface TokenBalanceCondition {
  type: 'token_balance';
  token: string;
  min: bigint;
}

/** Holds at least `min` items of a SEP-50 style collection (`balance(Address) -> u32`). */
export interface NftBalanceCondition {
  type: 'nft_balance';
  collection: string;
  min: number;
}

/** Ledger time in `[notBefore, notAfter)`, unix seconds. `null` leaves that side open. */
export interface TimeWindowCondition {
  type: 'time_window';
  notBefore: bigint | null;
  notAfter: bigint | null;
}

export type Condition = TokenBalanceCondition | NftBalanceCondition | TimeWindowCondition;

/** The part of a policy that decides a decision. */
export interface PolicyRules {
  version: number;
  active: boolean;
  conditions: readonly Condition[];
}

export interface Policy extends PolicyRules {
  owner: string;
}

export interface Decision {
  allowed: boolean;
  /** The policy version that was evaluated. */
  version: number;
  /** Index of the first failing condition; `null` when allowed or when the policy is inactive. */
  failedIndex: number | null;
  /** `'None'` exactly when `allowed` is true. */
  reason: DenyReason;
}

/** What reading one balance produced. `unavailable` covers an error, a panic, a missing function and a wrong type. */
export type Reading = { status: 'ok'; value: bigint } | { status: 'unavailable' };

/** Everything an evaluation needs to know about the world, for one subject. */
export interface Snapshot {
  /** Ledger time in unix seconds. */
  timestamp: bigint;
  /** Balance readings for the subject, keyed by `readingKey`. */
  readings: ReadonlyMap<string, Reading>;
}

/** The key under which a balance condition's reading is stored in a snapshot. */
export function readingKey(condition: TokenBalanceCondition | NftBalanceCondition): string {
  return condition.type === 'token_balance'
    ? `token_balance:${condition.token}`
    : `nft_balance:${condition.collection}`;
}

export function denyReasonFromCode(code: number): DenyReason {
  for (const [name, value] of Object.entries(DENY_REASON_CODES)) {
    if (value === code) return name as DenyReason;
  }
  throw new RangeError(`Unknown deny reason code ${code}`);
}
