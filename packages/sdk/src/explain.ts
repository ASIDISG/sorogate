/**
 * Plain-language descriptions of conditions and decisions, for showing to a person.
 *
 * Nothing here decides anything: it only describes a `Decision` that `evaluate` or the contract produced, and the
 * conditions of the policy it came from.
 */
import { fromBaseUnits } from './amounts.js';
import type { Condition, Decision } from './types.js';

export interface DescribeOptions {
  /** Decimals of the tokens a policy names, by address, so amounts can be shown as a person would write them. */
  decimals?: Readonly<Record<string, number>>;
}

/** `CABC…WXYZ`: the start and end of an address, enough to recognise it. */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 5)}…${address.slice(-4)}`;
}

const LAST_REPRESENTABLE_SECOND = 253402300799n; // 9999-12-31 23:59:59, the last second a calendar date can show

/** Unix seconds as `2026-10-07 01:21:45 UTC`, or the raw number when it is beyond any calendar date. */
export function formatUnixSeconds(seconds: bigint): string {
  if (seconds > LAST_REPRESENTABLE_SECOND) return `${seconds} (unix seconds)`;
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** One condition as a sentence fragment: "holds at least 100 of token CABC…WXYZ". */
export function describeCondition(condition: Condition, options: DescribeOptions = {}): string {
  switch (condition.type) {
    case 'token_balance': {
      const decimals = options.decimals?.[condition.token];
      const amount =
        decimals === undefined ? `${condition.min} (in the token's smallest unit)` : fromBaseUnits(condition.min, decimals);
      return `holds at least ${amount} of token ${shortAddress(condition.token)}`;
    }
    case 'nft_balance':
      return `holds at least ${condition.min} of collection ${shortAddress(condition.collection)}`;
    case 'time_window': {
      const { notBefore, notAfter } = condition;
      if (notBefore !== null && notAfter !== null) {
        return `the ledger time is from ${formatUnixSeconds(notBefore)} until ${formatUnixSeconds(notAfter)}`;
      }
      if (notBefore !== null) return `the ledger time is ${formatUnixSeconds(notBefore)} or later`;
      if (notAfter !== null) return `the ledger time is before ${formatUnixSeconds(notAfter)}`;
      return 'any time'; // not a valid policy, but describing it should not fail
    }
  }
}

/**
 * A decision as a sentence or two. Pass the policy's conditions to name the one that failed; without them the
 * sentence says which condition number it was.
 */
export function explainDecision(decision: Decision, conditions?: readonly Condition[], options: DescribeOptions = {}): string {
  const version = `policy version ${decision.version}`;
  if (decision.allowed) return `Allowed: every condition holds (${version}).`;
  if (decision.reason === 'Inactive') return `Denied: the owner of this policy has deactivated it (${version}).`;

  const index = decision.failedIndex;
  const condition = index === null ? undefined : conditions?.[index];
  const which = index === null ? 'a condition' : `condition ${index + 1}${conditions ? ` of ${conditions.length}` : ''}`;
  const what = condition === undefined ? '' : `: ${describeCondition(condition, options)}`;

  switch (decision.reason) {
    case 'BelowMinimum':
      return `Denied: ${which} is not met${what}. The balance is lower (${version}).`;
    case 'BalanceUnavailable':
      return (
        `Denied: ${which} could not be checked${what}. The token did not report a balance. For a classic Stellar asset ` +
        `this usually means the address holds none of it (it has no trustline); it can also mean the contract is not a ` +
        `working token (${version}).`
      );
    case 'BeforeWindow':
      return `Denied: it is too early. ${which} is not met yet${what} (${version}).`;
    case 'AfterWindow':
      return `Denied: it is too late. ${which} has passed${what} (${version}).`;
    default:
      return `Denied (${version}).`;
  }
}
