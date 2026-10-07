/**
 * Generates random vector files in the format of `spec/vectors`, for differential testing. The expected answers come
 * from the TypeScript model; the contract's harness must give the same answer for every case. The same seed always
 * produces the same files. The command line is `generate-random.ts`.
 */
import { evaluate, validateConditions } from '../src/index.js';
import {
  evaluateFileSchema,
  rulesFor,
  snapshotFor,
  toCondition,
  validateFileSchema,
  type ConditionJson,
  type EvaluateFile,
  type TokenDef,
  type ValidateFile,
} from '../test/vectorlib.js';

const I128_MAX = (2n ** 127n - 1n).toString();
const U64_MAX = (2n ** 64n - 1n).toString();
const SUBJECTS = ['alice', 'bob', 'carol', 'dave'] as const;

/** A small, fast, seedable generator (mulberry32). Not for anything but tests. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }
}

const clamp = (v: bigint, lo: bigint, hi: bigint): bigint => (v < lo ? lo : v > hi ? hi : v);
const INTERESTING_I128 = ['0', '1', '2', '99', '100', '101', '1000000000000000000000', I128_MAX, (2n ** 127n - 2n).toString()];

// ---------------------------------------------------------------- a world of named tokens

interface World {
  tokens: Record<string, TokenDef>;
  fungible: string[];
  collections: string[];
  odd: string[];
}

function makeWorld(rng: Rng, withNonContracts: boolean): World {
  const tokens: Record<string, TokenDef> = {};
  const fungible: string[] = [];
  const collections: string[] = [];
  for (let i = 0; i < 4; i++) {
    const balances: Record<string, string> = {};
    for (const who of SUBJECTS) if (rng.chance(0.75)) balances[who] = rng.pick(INTERESTING_I128);
    tokens[`coin${i}`] = { kind: 'i128', balances };
    fungible.push(`coin${i}`);
  }
  for (let i = 0; i < 3; i++) {
    const balances: Record<string, number> = {};
    for (const who of SUBJECTS) if (rng.chance(0.75)) balances[who] = rng.pick([0, 1, 2, 3, 4294967295]);
    tokens[`set${i}`] = { kind: 'u32', balances };
    collections.push(`set${i}`);
  }
  tokens.wide = { kind: 'u64' };
  tokens.broken = { kind: 'panics' };
  tokens.nofn = { kind: 'no_balance_function' };
  const odd = ['wide', 'broken', 'nofn'];
  if (withNonContracts) {
    tokens.acct = { kind: 'account' };
    tokens.gone = { kind: 'missing' };
    odd.push('acct', 'gone');
  }
  return { tokens, fungible, collections, odd };
}

function balanceOf(def: TokenDef | undefined, subject: string): bigint | null {
  if (def?.kind === 'i128') return BigInt(def.balances?.[subject] ?? '0');
  if (def?.kind === 'u32') return BigInt(def.balances?.[subject] ?? 0);
  return null;
}

// ---------------------------------------------------------------- conditions

/** A minimum near the subject's real balance, so that cases land on the "equal / one below / one above" edges. */
function minimumFor(rng: Rng, balance: bigint | null, max: bigint): bigint {
  const candidates: bigint[] = [1n, 2n, 100n];
  if (balance !== null) candidates.push(balance, balance + 1n, balance - 1n, balance, balance);
  return clamp(rng.pick(candidates), 1n, max);
}

function validCondition(rng: Rng, world: World, subject: string, now: bigint): ConditionJson {
  const kind = rng.pick(['token', 'token', 'nft', 'window', 'window'] as const);
  if (kind === 'token') {
    const name = rng.chance(0.8) ? rng.pick(world.fungible) : rng.pick([...world.collections, ...world.odd]);
    return { type: 'token_balance', token: name, min: minimumFor(rng, balanceOf(world.tokens[name], subject), 2n ** 127n - 1n).toString() };
  }
  if (kind === 'nft') {
    const name = rng.chance(0.8) ? rng.pick(world.collections) : rng.pick([...world.fungible, ...world.odd]);
    return { type: 'nft_balance', collection: name, min: Number(minimumFor(rng, balanceOf(world.tokens[name], subject), 4294967295n)) };
  }
  for (;;) {
    const edges = [now - 1n, now, now + 1n, now + 5n, now - 5n].map((v) => clamp(v, 0n, BigInt(U64_MAX)));
    const from = rng.chance(0.25) ? null : rng.pick(edges);
    const to = rng.chance(0.25) ? null : rng.pick([...edges, clamp(now + 1000n, 0n, BigInt(U64_MAX))]);
    if (from === null && to === null) continue;
    if (from !== null && to !== null && from >= to) continue;
    return { type: 'time_window', notBefore: from === null ? null : from.toString(), notAfter: to === null ? null : to.toString() };
  }
}

// ---------------------------------------------------------------- the two files

export function generateEvaluate(rng: Rng, count: number, seed: number): EvaluateFile {
  const world = makeWorld(rng, false);
  const cases: EvaluateFile['cases'] = [];
  for (let i = 0; i < count; i++) {
    const subject = rng.pick(SUBJECTS);
    const timestamp = rng.chance(0.03) ? BigInt(U64_MAX) : BigInt(rng.int(1001));
    const conditions = Array.from({ length: 1 + rng.int(8) }, () => validCondition(rng, world, subject, timestamp));
    const policy: EvaluateFile['cases'][number]['policy'] = { conditions };
    if (rng.chance(0.1)) policy.active = false;
    if (rng.chance(0.2)) policy.extraUpdates = 1 + rng.int(3);

    const rules = rulesFor(policy);
    const decision = evaluate(rules, snapshotFor(world.tokens, rules.conditions, subject, timestamp));
    cases.push({
      name: `random ${seed}#${i}`,
      timestamp: timestamp.toString(),
      policy,
      subject,
      expect: decision,
    });
  }
  return evaluateFileSchema.parse({
    schema: 1,
    description: `Randomly generated (seed ${seed}, ${count} cases). Expected answers come from the TypeScript model.`,
    tokens: world.tokens,
    cases,
  });
}

function invalidCondition(rng: Rng, world: World): ConditionJson {
  return rng.pick<() => ConditionJson>([
    () => ({ type: 'token_balance', token: rng.pick(world.fungible), min: rng.pick(['0', '-1', '-170141183460469231731687303715884105728']) }),
    () => ({ type: 'nft_balance', collection: rng.pick(world.collections), min: 0 }),
    () => ({ type: 'time_window', notBefore: null, notAfter: null }),
    () => ({ type: 'time_window', notBefore: '100', notAfter: '100' }),
    () => ({ type: 'time_window', notBefore: '200', notAfter: '100' }),
    () => ({ type: 'token_balance', token: rng.pick(['acct', 'gone']), min: '1' }),
    () => ({ type: 'nft_balance', collection: rng.pick(['acct', 'gone']), min: 1 }),
  ])();
}

export function generateValidate(rng: Rng, count: number, seed: number): ValidateFile {
  const world = makeWorld(rng, true);
  const isContract = (name: string): boolean => {
    const kind = world.tokens[name]?.kind;
    return kind !== undefined && kind !== 'account' && kind !== 'missing';
  };
  const cases: ValidateFile['cases'] = [];
  for (let i = 0; i < count; i++) {
    const length = rng.chance(0.05) ? 0 : 1 + rng.int(10); // up to 10: both sides of the limit of 8
    const conditions = Array.from({ length }, () =>
      rng.chance(0.15) ? invalidCondition(rng, world) : validCondition(rng, world, 'alice', BigInt(rng.int(1001))),
    );
    const result = validateConditions(conditions.map(toCondition), isContract);
    cases.push({ name: `random ${seed}#${i}`, conditions, expect: result });
  }
  return validateFileSchema.parse({
    schema: 1,
    description: `Randomly generated (seed ${seed}, ${count} cases). Expected answers come from the TypeScript model.`,
    tokens: world.tokens,
    cases,
  });
}
