/**
 * Telling whether two builds of a Soroban contract are the same code.
 *
 * `stellar contract build` records which version of the CLI made the file, in the contract's metadata section
 * (`contractmetav0`, an entry named `cliver`). Two builds of the same source with the same compiler therefore differ in a
 * few bytes, and so in their hash, when they were made with different CLI versions. Rebuilding with 28.1.0 a contract that
 * was deployed after a build with 27.1.0 differs in exactly the 38 bytes of that entry and in nothing else.
 *
 * `withoutCliVersion` blanks the value of that entry and leaves every other byte, so the hash of the result says "this
 * code, whichever CLI built it". It is a convenience for comparing builds, not a security property: anyone can write
 * anything in that entry, and the hash of the whole file, which includes it, is what the network identifies a contract by.
 */
import { createHash } from 'node:crypto';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function readLeb128(bytes: Uint8Array, at: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = at;
  for (;;) {
    const byte = bytes[i++] as number;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: i };
    shift += 7;
  }
}

/** The byte range of the `cliver` value inside the `contractmetav0` section, or `null` when the file has none. */
export function cliVersionRange(wasm: Uint8Array): { start: number; end: number } | null {
  if (wasm.length < 8 || Buffer.from(wasm.subarray(0, 4)).toString('latin1') !== '\0asm') throw new Error('not a WebAssembly file');
  let at = 8;
  while (at < wasm.length) {
    const id = wasm[at++] as number;
    const size = readLeb128(wasm, at);
    at = size.next;
    const end = at + size.value;
    if (id === 0) {
      const name = readLeb128(wasm, at);
      const label = Buffer.from(wasm.subarray(name.next, name.next + name.value)).toString('latin1');
      if (label === 'contractmetav0') {
        // There can be several: the SDK writes one and the CLI appends another that holds `cliver`.
        const found = findInMeta(wasm, name.next + name.value, end);
        if (found !== null) return found;
      }
    }
    at = end;
  }
  return null;
}

/** The metadata section is a list of XDR entries: a kind (u32), then a key and a value, each a length and padded bytes. */
function findInMeta(wasm: Uint8Array, from: number, end: number): { start: number; end: number } | null {
  const view = new DataView(wasm.buffer, wasm.byteOffset, wasm.byteLength);
  const padded = (n: number): number => Math.ceil(n / 4) * 4;
  let at = from;
  while (at + 12 <= end) {
    at += 4; // the entry's kind
    const keyLength = view.getUint32(at);
    const key = Buffer.from(wasm.subarray(at + 4, at + 4 + keyLength)).toString('latin1');
    at += 4 + padded(keyLength);
    const valueLength = view.getUint32(at);
    const start = at + 4;
    if (key === 'cliver') return { start, end: start + valueLength };
    at = start + padded(valueLength);
  }
  return null;
}

/** The same file with the value of its `cliver` entry replaced by zero bytes of the same length. */
export function withoutCliVersion(wasm: Uint8Array): Buffer {
  const copy = Buffer.from(wasm);
  const range = cliVersionRange(copy);
  if (range !== null) copy.fill(0, range.start, range.end);
  return copy;
}

export type Comparison = 'identical' | 'identical-except-cli-version' | 'different';

export function compareBuilds(a: Uint8Array, b: Uint8Array): Comparison {
  if (Buffer.from(a).equals(Buffer.from(b))) return 'identical';
  return withoutCliVersion(a).equals(withoutCliVersion(b)) ? 'identical-except-cli-version' : 'different';
}

export const hashes = (wasm: Uint8Array): { sha256: string; sha256WithoutCliVersion: string } => ({
  sha256: sha256(wasm),
  sha256WithoutCliVersion: sha256(withoutCliVersion(wasm)),
});
