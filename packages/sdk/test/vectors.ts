/** Loads and checks the shared vector files in `spec/vectors`, and turns them into SDK inputs. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { nativeToScVal, type xdr } from '@stellar/stellar-sdk';
import { z } from 'zod';

import {
  DENY_REASON_CODES,
  CONTRACT_ERROR_CODES,
  readingKey,
  type Condition,
  type Decision,
  type PolicyRules,
  type Reading,
  type Snapshot,
} from '../src/index.js';
import { decodeNftBalance, decodeTokenBalance } from '../src/index.js';

const decimal = z.string().regex(/^-?\d+$/, 'a decimal integer written as a string');

const conditionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('token_balance'), token: z.string(), min: decimal }),
  z.strictObject({ type: z.literal('nft_balance'), collection: z.string(), min: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('time_window'), notBefore: decimal.nullable(), notAfter: decimal.nullable() }),
]);

const tokenSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('i128'), balances: z.record(z.string(), decimal).optional() }),
  z.strictObject({ kind: z.literal('u32'), balances: z.record(z.string(), z.number().int().nonnegative()).optional() }),
  z.strictObject({ kind: z.literal('u64') }),
  z.strictObject({ kind: z.literal('panics') }),
  z.strictObject({ kind: z.literal('no_balance_function') }),
  z.strictObject({ kind: z.literal('account') }),
  z.strictObject({ kind: z.literal('missing') }),
]);

const denyReasons = Object.keys(DENY_REASON_CODES) as [keyof typeof DENY_REASON_CODES, ...(keyof typeof DENY_REASON_CODES)[]];
const errorNames = Object.keys(CONTRACT_ERROR_CODES) as [keyof typeof CONTRACT_ERROR_CODES, ...(keyof typeof CONTRACT_ERROR_CODES)[]];

const decisionSchema = z.strictObject({
  allowed: z.boolean(),
  version: z.number().int().positive(),
  failedIndex: z.number().int().nonnegative().nullable(),
  reason: z.enum(denyReasons),
});

const evaluateFileSchema = z.strictObject({
  schema: z.literal(1),
  description: z.string(),
  tokens: z.record(z.string(), tokenSchema),
  cases: z.array(
    z.strictObject({
      name: z.string().min(1),
      timestamp: decimal.optional(),
      policy: z.strictObject({
        active: z.boolean().optional(),
        extraUpdates: z.number().int().positive().optional(),
        conditions: z.array(conditionSchema),
      }),
      subject: z.string(),
      expect: decisionSchema,
    }),
  ),
});

const validateFileSchema = z.strictObject({
  schema: z.literal(1),
  description: z.string(),
  tokens: z.record(z.string(), tokenSchema),
  cases: z.array(
    z.strictObject({
      name: z.string().min(1),
      conditions: z.array(conditionSchema),
      expect: z.union([z.strictObject({ ok: z.literal(true) }), z.strictObject({ ok: z.literal(false), error: z.enum(errorNames) })]),
    }),
  ),
});

export type TokenDef = z.infer<typeof tokenSchema>;
export type ConditionJson = z.infer<typeof conditionSchema>;
export type EvaluateFile = z.infer<typeof evaluateFileSchema>;
export type ValidateFile = z.infer<typeof validateFileSchema>;

const dir = fileURLToPath(new URL('../../../spec/vectors/', import.meta.url));
const read = (name: string): unknown => JSON.parse(readFileSync(dir + name, 'utf8'));

export const evaluateVectors: EvaluateFile = evaluateFileSchema.parse(read('evaluate.json'));
export const validateVectors: ValidateFile = validateFileSchema.parse(read('validate.json'));

export function toCondition(json: ConditionJson): Condition {
  switch (json.type) {
    case 'token_balance':
      return { type: 'token_balance', token: json.token, min: BigInt(json.min) };
    case 'nft_balance':
      return { type: 'nft_balance', collection: json.collection, min: json.min };
    case 'time_window':
      return {
        type: 'time_window',
        notBefore: json.notBefore === null ? null : BigInt(json.notBefore),
        notAfter: json.notAfter === null ? null : BigInt(json.notAfter),
      };
  }
}

/** What a call to the token's `balance(subject)` returns, as the value the contract would see. `null` = the call fails. */
function returnValueOf(def: TokenDef, subject: string): xdr.ScVal | null {
  switch (def.kind) {
    case 'i128':
      return nativeToScVal(BigInt(def.balances?.[subject] ?? '0'), { type: 'i128' });
    case 'u32':
      return nativeToScVal(def.balances?.[subject] ?? 0, { type: 'u32' });
    case 'u64':
      return nativeToScVal(5n, { type: 'u64' });
    case 'panics':
    case 'no_balance_function':
      return null;
    case 'account':
    case 'missing':
      throw new Error(`token kind ${def.kind} cannot be evaluated; it is only for validation vectors`);
  }
}

export function snapshotFor(
  tokens: EvaluateFile['tokens'],
  conditions: readonly Condition[],
  subject: string,
  timestamp: bigint,
): Snapshot {
  const readings = new Map<string, Reading>();
  for (const condition of conditions) {
    if (condition.type === 'time_window') continue;
    const name = condition.type === 'token_balance' ? condition.token : condition.collection;
    const def = tokens[name];
    if (def === undefined) throw new Error(`vector refers to an undeclared token "${name}"`);
    const returnValue = returnValueOf(def, subject);
    readings.set(
      readingKey(condition),
      condition.type === 'token_balance' ? decodeTokenBalance(returnValue) : decodeNftBalance(returnValue),
    );
  }
  return { timestamp, readings };
}

export function rulesFor(policy: EvaluateFile['cases'][number]['policy']): PolicyRules {
  return {
    version: 1 + (policy.extraUpdates ?? 0),
    active: policy.active ?? true,
    conditions: policy.conditions.map(toCondition),
  };
}

export const expectedDecision = (d: z.infer<typeof decisionSchema>): Decision => d;
