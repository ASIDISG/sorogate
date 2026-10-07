/**
 * The part of the SDK that needs no network and no Stellar library: the types, validation, evaluation, amount
 * conversion and plain-language explanations. Use it where bundle size matters, for example in a web page that
 * only works a policy out locally. `test/model-entry.test.ts` checks that nothing reachable from here imports
 * `@stellar/stellar-sdk`.
 *
 * Everything exported here is also exported, unchanged, from the package root.
 */
export * from './types.js';
export { validateConditions, type ValidationResult } from './validate.js';
export { evaluate, MissingReadingError } from './evaluate.js';
export { AmountError, fromBaseUnits, toBaseUnits } from './amounts.js';
export { describeCondition, explainDecision, formatUnixSeconds, shortAddress, type DescribeOptions } from './explain.js';
