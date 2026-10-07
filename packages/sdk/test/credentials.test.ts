import { describe, expect, expectTypeOf, it } from 'vitest';

import type { CredentialSource } from '../src/credentials.js';

describe('CredentialSource', () => {
  it('can be implemented by anything that answers "does this address hold this kind of credential"', async () => {
    const holders = new Map<string, Set<string>>([['GALICE', new Set(['kyc'])]]);
    const source: CredentialSource = {
      async hasCredential(subject, kind) {
        return holders.get(subject)?.has(kind) ?? false;
      },
    };

    expect(await source.hasCredential('GALICE', 'kyc')).toBe(true);
    expect(await source.hasCredential('GALICE', 'age')).toBe(false);
    expect(await source.hasCredential('GBOB', 'kyc')).toBe(false);
    expectTypeOf(source.hasCredential).returns.resolves.toBeBoolean();
  });
});
