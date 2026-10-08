/**
 * What a person types into the playground, and how it becomes a model decision. Nothing here touches the page: the
 * form fills in a `Draft` (all text, as typed), `run` turns it into one of three outcomes, and the page draws that.
 */
import {
  describeCondition,
  evaluate,
  explainDecision,
  formatUnixSeconds,
  MAX_CONDITIONS,
  readingKey,
  validateConditions,
  type Condition,
  type ContractErrorName,
  type Decision,
  type PolicyRules,
  type Reading,
  type Snapshot,
} from '@sorogate/sdk/model';

export type ConditionDraft =
  | { type: 'token_balance'; token: string; min: string }
  | { type: 'nft_balance'; collection: string; min: string }
  | { type: 'time_window'; notBefore: string; notAfter: string };

/** What reading the subject's balance of one token or collection produced. `value` is typed text. */
export type ReadingDraft = { status: 'ok'; value: string } | { status: 'unavailable' };

export interface Draft {
  active: boolean;
  version: string;
  /** Ledger time, unix seconds. */
  timestamp: string;
  conditions: ConditionDraft[];
  /** One entry per token or collection the conditions name, keyed as `readingKey` keys them. */
  readings: Record<string, ReadingDraft>;
}

/** A token or collection a policy names, and the key of its balance reading. */
export interface Source {
  key: string;
  kind: 'token' | 'collection';
  name: string;
}

const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;
const U32_MAX = 4294967295n;
const U64_MAX = (1n << 64n) - 1n;

const DEFAULT_READING: ReadingDraft = { status: 'ok', value: '0' };

export function newCondition(type: ConditionDraft['type']): ConditionDraft {
  switch (type) {
    case 'token_balance':
      return { type, token: 'token', min: '100' };
    case 'nft_balance':
      return { type, collection: 'collection', min: '1' };
    case 'time_window':
      return { type, notBefore: '', notAfter: '' };
  }
}

export function emptyDraft(): Draft {
  return withReadings({ active: true, version: '1', timestamp: '0', conditions: [newCondition('token_balance')], readings: {} });
}

type BalanceDraft = Exclude<ConditionDraft, { type: 'time_window' }>;

/** The name of the token or collection a balance condition asks about, without surrounding space. */
function sourceName(condition: BalanceDraft): string {
  return (condition.type === 'token_balance' ? condition.token : condition.collection).trim();
}

function keyOf(condition: BalanceDraft): string {
  const name = sourceName(condition);
  return condition.type === 'token_balance'
    ? readingKey({ type: 'token_balance', token: name, min: 0n })
    : readingKey({ type: 'nft_balance', collection: name, min: 0 });
}

/** The tokens and collections the conditions name, once each, in the order they first appear. */
export function sources(conditions: readonly ConditionDraft[]): Source[] {
  const found = new Map<string, Source>();
  for (const condition of conditions) {
    if (condition.type === 'time_window') continue;
    const key = keyOf(condition);
    if (!found.has(key)) {
      found.set(key, { key, kind: condition.type === 'token_balance' ? 'token' : 'collection', name: sourceName(condition) });
    }
  }
  return [...found.values()];
}

/**
 * How far a slider for one source's balance should reach, so that the line where the answer flips sits in the middle of it.
 * `null` when no condition naming the source has a minimum a slider can show: not a plain whole number, or beyond a million
 * million, where a slider has no useful positions.
 */
export function sliderRange(
  conditions: readonly ConditionDraft[],
  source: Source,
): { max: number; step: number; minimum: number } | null {
  let minimum = 0;
  let found = false;
  for (const condition of conditions) {
    if (condition.type === 'time_window' || keyOf(condition) !== source.key) continue;
    const text = condition.min.trim();
    if (!/^\d+$/.test(text)) continue;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value > 1e12) continue;
    minimum = Math.max(minimum, value);
    found = true;
  }
  if (!found) return null;
  const max = Math.max(minimum * 2, source.kind === 'collection' ? 4 : 10);
  return { max, step: Math.max(1, Math.round(max / 200)), minimum };
}

/** The draft with exactly one reading per source: readings of sources no longer named are dropped, new ones start at 0. */
export function withReadings(draft: Draft): Draft {
  const readings: Record<string, ReadingDraft> = {};
  for (const source of sources(draft.conditions)) readings[source.key] = draft.readings[source.key] ?? DEFAULT_READING;
  return { ...draft, readings };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

/** A whole number written in decimal digits, nothing else: no empty text, no `0x10`, no `1e3`, no `1.5`. */
function parseWhole(text: string, what: string, low: bigint, high: bigint): Parsed<bigint> {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return { ok: false, problem: `${what} must be a whole number.` };
  const value = BigInt(trimmed);
  if (value < low || value > high) return { ok: false, problem: `${what} must be between ${low} and ${high}.` };
  return { ok: true, value };
}

function parseBound(text: string, what: string): Parsed<bigint | null> {
  if (text.trim() === '') return { ok: true, value: null };
  return parseWhole(text, what, 0n, U64_MAX);
}

export type Parse = { ok: true; rules: PolicyRules; snapshot: Snapshot } | { ok: false; problems: string[] };

/** Reads every typed value. Lists all the problems at once rather than the first. */
export function parseDraft(draft: Draft): Parse {
  const problems = new Set<string>();
  const failed = <T>(parsed: Parsed<T>): parsed is { ok: false; problem: string } => {
    if (!parsed.ok) problems.add(parsed.problem);
    return !parsed.ok;
  };

  const version = parseWhole(draft.version, 'The policy version', 1n, U32_MAX);
  const timestamp = parseWhole(draft.timestamp, 'The ledger time', 0n, U64_MAX);
  failed(version);
  failed(timestamp);

  const conditions: Condition[] = [];
  const readings = new Map<string, Reading>();

  const readBalance = (key: string, what: string, high: bigint): void => {
    const reading = draft.readings[key] ?? DEFAULT_READING;
    if (reading.status === 'unavailable') {
      readings.set(key, { status: 'unavailable' });
      return;
    }
    const value = parseWhole(reading.value, `The balance in ${what}`, 0n, high);
    if (!failed(value)) readings.set(key, { status: 'ok', value: value.value });
  };

  draft.conditions.forEach((condition, index) => {
    const label = `Condition ${index + 1}`;
    switch (condition.type) {
      case 'token_balance': {
        const token = condition.token.trim();
        if (token === '') problems.add(`${label}: name the token.`);
        const min = parseWhole(condition.min, `${label}: the minimum`, I128_MIN, I128_MAX);
        if (!failed(min) && token !== '') {
          conditions.push({ type: 'token_balance', token, min: min.value });
          readBalance(keyOf(condition), `token ${token}`, I128_MAX);
        }
        break;
      }
      case 'nft_balance': {
        const collection = condition.collection.trim();
        if (collection === '') problems.add(`${label}: name the collection.`);
        const min = parseWhole(condition.min, `${label}: the minimum`, 0n, U32_MAX);
        if (!failed(min) && collection !== '') {
          conditions.push({ type: 'nft_balance', collection, min: Number(min.value) });
          readBalance(keyOf(condition), `collection ${collection}`, U32_MAX);
        }
        break;
      }
      case 'time_window': {
        const notBefore = parseBound(condition.notBefore, `${label}: the opening time`);
        const notAfter = parseBound(condition.notAfter, `${label}: the closing time`);
        if (!failed(notBefore) && !failed(notAfter)) {
          conditions.push({ type: 'time_window', notBefore: notBefore.value, notAfter: notAfter.value });
        }
        break;
      }
    }
  });

  if (problems.size > 0 || !version.ok || !timestamp.ok) return { ok: false, problems: [...problems] };
  return {
    ok: true,
    rules: { version: Number(version.value), active: draft.active, conditions },
    snapshot: { timestamp: timestamp.value, readings },
  };
}

/** What the contract does when asked to store a policy that fails one of its checks, in words. */
const REFUSALS: Record<ContractErrorName, string> = {
  NoConditions: 'A policy needs at least one condition.',
  TooManyConditions: `A policy can hold at most ${MAX_CONDITIONS} conditions.`,
  InvalidMinimum: 'A minimum must be greater than zero.',
  InvalidTimeWindow: 'A time window needs at least one bound, and when it has both, it must open before it closes.',
  NotAContract: 'A token or collection must be a deployed contract.',
  PolicyNotFound: 'There is no such policy.',
};

export type Outcome =
  | { kind: 'invalid-input'; problems: string[] }
  | { kind: 'refused'; error: ContractErrorName; message: string }
  | { kind: 'decision'; decision: Decision; explanation: string; described: string[]; ledgerTime: string };

export function run(draft: Draft): Outcome {
  const parsed = parseDraft(draft);
  if (!parsed.ok) return { kind: 'invalid-input', problems: parsed.problems };

  const validation = validateConditions(parsed.rules.conditions);
  if (!validation.ok) return { kind: 'refused', error: validation.error, message: REFUSALS[validation.error] };

  const decision = evaluate(parsed.rules, parsed.snapshot);
  return {
    kind: 'decision',
    decision,
    explanation: explainDecision(decision, parsed.rules.conditions),
    described: parsed.rules.conditions.map((condition) => describeCondition(condition)),
    ledgerTime: formatUnixSeconds(parsed.snapshot.timestamp),
  };
}

/** The same inputs, whatever order the fields were filled in and however much space surrounds the text. */
function canonical(draft: Draft): string {
  const tidy = withReadings(draft);
  return JSON.stringify({
    active: tidy.active,
    version: tidy.version.trim(),
    timestamp: tidy.timestamp.trim(),
    conditions: tidy.conditions.map((c) =>
      c.type === 'token_balance'
        ? [c.type, c.token.trim(), c.min.trim()]
        : c.type === 'nft_balance'
          ? [c.type, c.collection.trim(), c.min.trim()]
          : [c.type, c.notBefore.trim(), c.notAfter.trim()],
    ),
    readings: Object.keys(tidy.readings)
      .sort()
      .map((key) => {
        const reading = tidy.readings[key] as ReadingDraft;
        return [key, reading.status === 'ok' ? reading.value.trim() : null];
      }),
  });
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return canonical(a) === canonical(b);
}
