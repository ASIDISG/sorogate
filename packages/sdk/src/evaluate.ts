import { readingKey, type Condition, type Decision, type DenyReason, type PolicyRules, type Snapshot } from './types.js';

/** A balance condition was reached but the snapshot has no reading for it. That is a bug in the caller. */
export class MissingReadingError extends Error {
  constructor(public readonly key: string) {
    super(`The snapshot has no balance reading for ${key}`);
    this.name = 'MissingReadingError';
  }
}

/**
 * A model of the contract's `evaluate` with no network access (`spec/SPEC.md` section 4): the first condition,
 * in order, that does not hold decides the answer, and conditions after it are not looked at, so their readings
 * are not needed.
 *
 * The contract is authoritative. This function exists to preview a policy, explain a decision, evaluate with
 * cached readings, and serve as the test oracle; the shared vectors in `spec/vectors` keep it in step.
 */
export function evaluate(policy: PolicyRules, snapshot: Snapshot): Decision {
  const { version } = policy;
  if (!policy.active) {
    return { allowed: false, version, failedIndex: null, reason: 'Inactive' };
  }
  for (const [index, condition] of policy.conditions.entries()) {
    const reason = failureOf(condition, snapshot);
    if (reason !== null) {
      return { allowed: false, version, failedIndex: index, reason };
    }
  }
  return { allowed: true, version, failedIndex: null, reason: 'None' };
}

function failureOf(condition: Condition, snapshot: Snapshot): DenyReason | null {
  switch (condition.type) {
    case 'token_balance':
    case 'nft_balance': {
      const key = readingKey(condition);
      const reading = snapshot.readings.get(key);
      if (reading === undefined) throw new MissingReadingError(key);
      if (reading.status === 'unavailable') return 'BalanceUnavailable';
      return reading.value >= BigInt(condition.min) ? null : 'BelowMinimum';
    }
    case 'time_window': {
      const { notBefore, notAfter } = condition;
      if (notBefore !== null && snapshot.timestamp < notBefore) return 'BeforeWindow';
      if (notAfter !== null && snapshot.timestamp >= notAfter) return 'AfterWindow';
      return null;
    }
  }
}
