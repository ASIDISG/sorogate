/**
 * Writes random vector files for differential testing.
 *
 *   tsx scripts/generate-random.ts --seed 42 --count 500 --out ../../spec/vectors/generated
 *
 * Point `SOROGATE_RANDOM_VECTORS` at the output directory and run `cargo test -p access-policy --test vectors` to
 * compare the contract with the TypeScript model on these cases. See `random-vectors.ts` for how they are made.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { generateEvaluate, generateValidate, Rng } from './random-vectors.js';

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

const seed = Number(option('seed', '1'));
const count = Number(option('count', '500'));
const out = resolve(option('out', '../../spec/vectors/generated'));
if (!Number.isInteger(seed) || !Number.isInteger(count) || count < 1) {
  throw new Error('--seed and --count must be integers, and --count at least 1');
}

mkdirSync(out, { recursive: true });
writeFileSync(`${out}/evaluate.json`, JSON.stringify(generateEvaluate(new Rng(seed), count, seed), null, 1) + '\n');
writeFileSync(`${out}/validate.json`, JSON.stringify(generateValidate(new Rng(seed ^ 0x9e3779b9), count, seed), null, 1) + '\n');
console.log(`seed ${seed}: wrote ${count} evaluate and ${count} validate cases to ${out}`);
