import { MAX_CONDITIONS, type Condition, type ContractErrorName } from './types.js';

export type ValidationResult = { ok: true } | { ok: false; error: ContractErrorName };

/**
 * The checks the contract makes when a policy is created or updated, in the same order, so the same input
 * gives the same error (`spec/SPEC.md` section 3).
 *
 * `isContract` answers whether an address is a deployed contract. Only a network can know that, so it is
 * supplied by the caller; when it is omitted the `NotAContract` check is skipped and the contract will still
 * make it.
 */
export function validateConditions(
  conditions: readonly Condition[],
  isContract?: (address: string) => boolean,
): ValidationResult {
  if (conditions.length === 0) return { ok: false, error: 'NoConditions' };
  if (conditions.length > MAX_CONDITIONS) return { ok: false, error: 'TooManyConditions' };

  for (const condition of conditions) {
    switch (condition.type) {
      case 'token_balance':
        if (condition.min <= 0n) return { ok: false, error: 'InvalidMinimum' };
        if (isContract && !isContract(condition.token)) return { ok: false, error: 'NotAContract' };
        break;
      case 'nft_balance':
        if (condition.min <= 0) return { ok: false, error: 'InvalidMinimum' };
        if (isContract && !isContract(condition.collection)) return { ok: false, error: 'NotAContract' };
        break;
      case 'time_window': {
        const { notBefore, notAfter } = condition;
        if (notBefore === null && notAfter === null) return { ok: false, error: 'InvalidTimeWindow' };
        if (notBefore !== null && notAfter !== null && notBefore >= notAfter) {
          return { ok: false, error: 'InvalidTimeWindow' };
        }
        break;
      }
    }
  }
  return { ok: true };
}
