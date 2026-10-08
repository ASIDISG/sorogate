import { describe, expect, it } from 'vitest';

import { sameDraft, type Draft } from '../src/playground/draft';
import { examples } from '../src/playground/examples';
import { decodeDraft, encodeDraft, SHARE_PREFIX } from '../src/playground/share';

/** A fragment from an arbitrary object, the way a link from someone else could be made. */
const fragmentOf = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const good = { a: true, v: '1', t: '0', c: [{ type: 'token_balance', token: 'gold', min: '100' }], r: {} };

describe('a policy in a link', () => {
  it('comes back exactly as it went, for every example', () => {
    for (const example of examples) {
      const back = decodeDraft(`${SHARE_PREFIX}${encodeDraft(example.draft)}`);
      expect(back, example.name).not.toBeNull();
      expect(sameDraft(back as Draft, example.draft), example.name).toBe(true);
    }
  });

  it('survives text that is not plain ASCII', () => {
    const draft: Draft = { ...structuredClone(examples[0]!.draft), conditions: [{ type: 'token_balance', token: 'złoto 金 🪙', min: '5' }] };
    const back = decodeDraft(encodeDraft(draft));
    expect(back?.conditions[0]).toEqual({ type: 'token_balance', token: 'złoto 金 🪙', min: '5' });
  });

  it('fills in a missing reading instead of failing', () => {
    const back = decodeDraft(fragmentOf(good));
    expect(back?.readings['token_balance:gold']).toEqual({ status: 'ok', value: '0' });
  });

  it('gives up on anything that is not a policy', () => {
    for (const bad of [
      '',
      '#policy=',
      'not base64 !!',
      fragmentOf('a string'),
      fragmentOf(null),
      fragmentOf([]),
      fragmentOf({ ...good, a: 'yes' }),
      fragmentOf({ ...good, v: 1 }),
      fragmentOf({ ...good, c: 'none' }),
      fragmentOf({ ...good, c: [{ type: 'burn_everything' }] }),
      fragmentOf({ ...good, c: [{ type: 'token_balance', token: 5, min: '1' }] }),
      fragmentOf({ ...good, r: { 'token_balance:gold': { status: 'maybe' } } }),
      fragmentOf({ ...good, r: { 'token_balance:gold': { status: 'ok', value: 7 } } }),
    ]) {
      expect(decodeDraft(bad), bad).toBeNull();
    }
  });

  it('refuses more conditions than a policy may hold, and text that is far too long', () => {
    const tooMany = Array.from({ length: 9 }, () => ({ type: 'token_balance', token: 'gold', min: '1' }));
    expect(decodeDraft(fragmentOf({ ...good, c: tooMany }))).toBeNull();
    expect(decodeDraft(fragmentOf({ ...good, c: [{ type: 'token_balance', token: 'x'.repeat(201), min: '1' }] }))).toBeNull();
    expect(decodeDraft('A'.repeat(8001))).toBeNull();
  });

  it('does not let a crafted key reach the prototype', () => {
    const hostile = `{"a":true,"v":"1","t":"0","c":[],"r":{"__proto__":{"status":"unavailable"}}}`;
    expect(decodeDraft(Buffer.from(hostile, 'utf8').toString('base64url'))).toBeNull();
    expect(({} as Record<string, unknown>)['status']).toBeUndefined();
  });

  it('drops fields it does not know instead of keeping them', () => {
    const back = decodeDraft(fragmentOf({ ...good, extra: '<script>', c: [{ type: 'token_balance', token: 'gold', min: '1', onclick: 'x' }] }));
    expect(back).not.toBeNull();
    expect(JSON.stringify(back)).not.toContain('script');
    expect(JSON.stringify(back)).not.toContain('onclick');
  });
});
