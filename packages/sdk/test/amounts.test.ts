import { describe, expect, it } from 'vitest';

import { Rng } from '../scripts/random-vectors.js';
import { AmountError, fromBaseUnits, toBaseUnits } from '../src/index.js';

describe('toBaseUnits', () => {
  it('converts display amounts exactly', () => {
    expect(toBaseUnits('150', 7)).toBe(1_500_000_000n);
    expect(toBaseUnits('12.5', 7)).toBe(125_000_000n);
    expect(toBaseUnits('0.0000001', 7)).toBe(1n);
    expect(toBaseUnits('0', 7)).toBe(0n);
    expect(toBaseUnits('7', 0)).toBe(7n);
    expect(toBaseUnits('1.000000000000000001', 18)).toBe(1_000_000_000_000_000_001n);
  });

  it('ignores surrounding whitespace and keeps trailing zeros harmless', () => {
    expect(toBaseUnits('  3.50  ', 7)).toBe(35_000_000n);
    expect(toBaseUnits('00012', 2)).toBe(1200n);
  });

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 style trouble: these are all exact as text
    expect(toBaseUnits('0.3', 7)).toBe(3_000_000n);
    expect(toBaseUnits('9007199254740993', 0)).toBe(9007199254740993n); // above 2^53
    expect(toBaseUnits('9007199254740993.1', 1)).toBe(90071992547409931n);
  });

  it('refuses an amount with more decimal places than the token has instead of rounding it', () => {
    expect(() => toBaseUnits('0.00000001', 7)).toThrow(AmountError);
    expect(() => toBaseUnits('1.5', 0)).toThrow(AmountError);
  });

  it('refuses anything that is not plain digits with an optional decimal part', () => {
    for (const bad of ['', ' ', '-1', '+1', '1e3', '1,000', '.5', '5.', '1.2.3', 'abc', '0x10', '１２']) {
      expect(() => toBaseUnits(bad, 7), JSON.stringify(bad)).toThrow(AmountError);
    }
  });

  it('accepts 38 decimals and refuses 39, even for an amount of zero', () => {
    expect(toBaseUnits('0', 38)).toBe(0n);
    expect(() => toBaseUnits('0', 39)).toThrow(AmountError);
    expect(() => fromBaseUnits(0n, 39)).toThrow(AmountError);
  });

  it('refuses decimals that are not a whole number from 0 to 38, in both directions', () => {
    for (const bad of [-1, 39, 1.5, Number.NaN]) {
      expect(() => toBaseUnits('1', bad), `toBaseUnits with ${bad}`).toThrow(AmountError);
      expect(() => fromBaseUnits(5n, bad), `fromBaseUnits with ${bad}`).toThrow(AmountError);
    }
  });

  it('accepts the largest amount a token can hold and refuses one more', () => {
    const max = 2n ** 127n - 1n;
    expect(toBaseUnits(max.toString(), 0)).toBe(max);
    expect(() => toBaseUnits((max + 1n).toString(), 0)).toThrow(AmountError);
    expect(() => toBaseUnits('99999999999999999999999999999999', 7)).toThrow(AmountError);
  });
});

describe('fromBaseUnits', () => {
  it('writes a display amount and drops trailing zeros', () => {
    expect(fromBaseUnits(1_500_000_000n, 7)).toBe('150');
    expect(fromBaseUnits(125_000_000n, 7)).toBe('12.5');
    expect(fromBaseUnits(15n, 7)).toBe('0.0000015');
    expect(fromBaseUnits(1n, 7)).toBe('0.0000001');
    expect(fromBaseUnits(0n, 7)).toBe('0');
    expect(fromBaseUnits(42n, 0)).toBe('42');
  });

  it('handles negative amounts, which a balance difference can be', () => {
    expect(fromBaseUnits(-125_000_000n, 7)).toBe('-12.5');
    expect(fromBaseUnits(-1n, 7)).toBe('-0.0000001');
  });

  it('writes the largest amount without losing a digit', () => {
    const max = 2n ** 127n - 1n;
    expect(fromBaseUnits(max, 0)).toBe(max.toString());
    expect(fromBaseUnits(max, 7)).toBe('17014118346046923173168730371588.4105727');
  });
});

describe('the two together', () => {
  it('round-trip any amount for any number of decimals', () => {
    const rng = new Rng(2024);
    for (let i = 0; i < 2000; i++) {
      const decimals = rng.int(19);
      const digits = 1 + rng.int(36);
      let amount = 0n;
      for (let d = 0; d < digits; d++) amount = amount * 10n + BigInt(rng.int(10));
      const shown = fromBaseUnits(amount, decimals);
      expect(toBaseUnits(shown, decimals), `${amount} with ${decimals} decimals shown as ${shown}`).toBe(amount);
    }
  });
});
