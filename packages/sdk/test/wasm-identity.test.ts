import { describe, expect, it } from 'vitest';

import { cliVersionRange, compareBuilds, hashes, withoutCliVersion } from '../scripts/wasm-identity.js';

const leb = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
};
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const xdrString = (s: string): number[] => {
  const bytes = [...Buffer.from(s, 'latin1')];
  while (bytes.length % 4 !== 0) bytes.push(0);
  return [...u32(s.length), ...bytes];
};
const metaEntry = (key: string, value: string): number[] => [...u32(0), ...xdrString(key), ...xdrString(value)];
const customSection = (name: string, payload: number[]): number[] => {
  const body = [...leb(name.length), ...Buffer.from(name, 'latin1'), ...payload];
  return [0, ...leb(body.length), ...body];
};

/** A minimal WebAssembly file shaped like what `stellar contract build` writes: a code-ish section, then the metadata. */
function build(options: { code?: number[]; cliver?: string; rsver?: string; withMeta?: boolean } = {}): Buffer {
  const { code = [1, 2, 3, 4, 5], cliver = '27.1.0#8e402ea28202950b272fbabc34caad4d2f64fe87', rsver = '1.96.0', withMeta = true } = options;
  // Like the real thing: the SDK's metadata section, and a second one, added by the CLI, that holds `cliver`.
  const meta = withMeta
    ? [
        ...customSection('contractmetav0', [...metaEntry('rsver', rsver), ...metaEntry('rssdkver', '28.0.0')]),
        ...customSection('contractmetav0', metaEntry('cliver', cliver)),
      ]
    : [];
  return Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 1, code.length, ...code, ...meta]);
}

describe('telling builds of one contract apart from different contracts', () => {
  const a = build();
  const otherCli = build({ cliver: '28.1.0#c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd' });

  it('finds the CLI version entry', () => {
    const range = cliVersionRange(a);
    expect(range).not.toBeNull();
    expect(Buffer.from(a.subarray(range!.start, range!.end)).toString('latin1')).toBe('27.1.0#8e402ea28202950b272fbabc34caad4d2f64fe87');
  });

  it('also finds it when it shares a section with other entries', () => {
    const shared = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...customSection('contractmetav0', [...metaEntry('rsver', '1.96.0'), ...metaEntry('cliver', '27.1.0#abc')])]);
    const range = cliVersionRange(shared);
    expect(Buffer.from(shared.subarray(range!.start, range!.end)).toString('latin1')).toBe('27.1.0#abc');
  });

  it('calls a byte-for-byte copy identical', () => {
    expect(compareBuilds(a, Buffer.from(a))).toBe('identical');
  });

  it('forgives a different CLI version, and only that, and the whole-file hashes still differ', () => {
    expect(compareBuilds(a, otherCli)).toBe('identical-except-cli-version');
    expect(hashes(a).sha256).not.toBe(hashes(otherCli).sha256);
    expect(hashes(a).sha256WithoutCliVersion).toBe(hashes(otherCli).sha256WithoutCliVersion);
  });

  it('does not forgive different code', () => {
    expect(compareBuilds(a, build({ code: [1, 2, 3, 4, 6] }))).toBe('different');
    expect(compareBuilds(a, build({ code: [1, 2, 3, 4, 6], cliver: '28.1.0#c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd' }))).toBe('different');
  });

  it('does not forgive any other metadata, such as the compiler version', () => {
    expect(compareBuilds(a, build({ rsver: '1.97.0' }))).toBe('different');
  });

  it('leaves a file with no metadata as it is', () => {
    const bare = build({ withMeta: false });
    expect(cliVersionRange(bare)).toBeNull();
    expect(withoutCliVersion(bare).equals(bare)).toBe(true);
  });

  it('does not change the length of the file', () => {
    expect(withoutCliVersion(a).length).toBe(a.length);
  });

  it('refuses something that is not WebAssembly', () => {
    expect(() => cliVersionRange(Buffer.from('not a wasm file at all'))).toThrow(/not a WebAssembly file/);
  });
});
