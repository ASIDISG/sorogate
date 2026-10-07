/** Loads and checks the shared vector files in `spec/vectors`. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { evaluateFileSchema, validateFileSchema, type EvaluateFile, type ValidateFile } from './vectorlib.js';

export * from './vectorlib.js';

const dir = fileURLToPath(new URL('../../../spec/vectors/', import.meta.url));
const read = (name: string): unknown => JSON.parse(readFileSync(dir + name, 'utf8'));

export const evaluateVectors: EvaluateFile = evaluateFileSchema.parse(read('evaluate.json'));
export const validateVectors: ValidateFile = validateFileSchema.parse(read('validate.json'));
