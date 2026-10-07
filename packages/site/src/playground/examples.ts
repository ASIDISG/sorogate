/**
 * The playground's examples are the shared test vectors in `spec/vectors/evaluate.json`: the same cases the contract
 * and the TypeScript model are both run against. Each carries the answer the contract is recorded as giving, so the page
 * can set it beside the model's. Nothing here is written for the page.
 */
import type { Decision } from '@sorogate/sdk/model';

import evaluateVectors from '../../../../spec/vectors/evaluate.json';
import { sources, withReadings, type ConditionDraft, type Draft, type ReadingDraft } from './draft';

interface VectorToken {
  kind: string;
  balances?: Record<string, string | number>;
}

type VectorCondition =
  | { type: 'token_balance'; token: string; min: string }
  | { type: 'nft_balance'; collection: string; min: number }
  | { type: 'time_window'; notBefore: string | null; notAfter: string | null };

interface VectorCase {
  name: string;
  timestamp?: string;
  policy: { active?: boolean; extraUpdates?: number; conditions: VectorCondition[] };
  subject: string;
  expect: Decision;
}

export interface VectorFile {
  tokens: Record<string, VectorToken>;
  cases: VectorCase[];
}

export interface Example {
  name: string;
  draft: Draft;
  /** What the contract is recorded as answering for exactly this input. */
  recorded: Decision;
}

function conditionDraft(condition: VectorCondition): ConditionDraft {
  switch (condition.type) {
    case 'token_balance':
      return { type: 'token_balance', token: condition.token, min: condition.min };
    case 'nft_balance':
      return { type: 'nft_balance', collection: condition.collection, min: String(condition.min) };
    case 'time_window':
      return { type: 'time_window', notBefore: condition.notBefore ?? '', notAfter: condition.notAfter ?? '' };
  }
}

/**
 * What `balance(subject)` gives for a token the vectors describe, read by a condition that expects `expects`: an `i128`
 * for a token, a `u32` for a collection. A number of the other kind, an error, or no `balance` function at all cannot
 * be read as a balance, and the model records that as unavailable.
 */
function readingFor(token: VectorToken, subject: string, expects: 'i128' | 'u32'): ReadingDraft {
  if (token.kind === expects) return { status: 'ok', value: String(token.balances?.[subject] ?? 0) };
  if (['i128', 'u32', 'u64', 'panics', 'no_balance_function'].includes(token.kind)) return { status: 'unavailable' };
  throw new Error(`token kind ${token.kind} cannot be shown as an example`);
}

export function examplesFrom(file: VectorFile): Example[] {
  return file.cases.map((vector) => {
    const draft = withReadings({
      active: vector.policy.active ?? true,
      version: String(1 + (vector.policy.extraUpdates ?? 0)),
      timestamp: vector.timestamp ?? '0',
      conditions: vector.policy.conditions.map(conditionDraft),
      readings: {},
    });
    for (const source of sources(draft.conditions)) {
      const token = file.tokens[source.name];
      if (token === undefined) throw new Error(`example "${vector.name}" names an undeclared token "${source.name}"`);
      draft.readings[source.key] = readingFor(token, vector.subject, source.kind === 'token' ? 'i128' : 'u32');
    }
    return { name: vector.name, draft, recorded: vector.expect };
  });
}

export const examples: readonly Example[] = examplesFrom(evaluateVectors as unknown as VectorFile);
