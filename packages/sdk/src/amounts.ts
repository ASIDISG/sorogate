/**
 * Display amounts and base units.
 *
 * A policy's `min` is in a token's **base units** (the smallest unit): for a token with 7 decimals, one whole token is
 * 10,000,000. Passing a display amount by mistake gives a minimum that is off by a factor of ten to the number of
 * decimals, so use these helpers whenever a person types or reads an amount. They work on exact decimal text and
 * never touch floating point.
 */

/** The largest amount a token can hold in the `i128` a policy compares against. */
const I128_MAX = 2n ** 127n - 1n;

/** An amount could not be converted without losing or inventing precision. */
export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

function checkDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new AmountError(`decimals must be a whole number from 0 to 38, got ${decimals}`);
  }
}

/**
 * Converts a display amount such as `"12.5"` to base units. Accepts plain digits with an optional fractional part and
 * nothing else: no sign, no exponent, no thousands separators. Refuses an amount with more decimal places than the
 * token has, instead of rounding it.
 */
export function toBaseUnits(display: string, decimals: number): bigint {
  checkDecimals(decimals);
  const text = display.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) {
    throw new AmountError(`"${display}" is not an amount: use digits with an optional decimal part, like 12.5`);
  }
  const whole = match[1] as string;
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) {
    throw new AmountError(`"${display}" has ${fraction.length} decimal places but the token has only ${decimals}`);
  }
  const amount = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (amount > I128_MAX) throw new AmountError(`"${display}" is more than a token can hold`);
  return amount;
}

/**
 * Converts base units to a display amount: `150_0000000n` with 7 decimals is `"150"`, `15n` is `"0.0000015"`.
 * Trailing zeros in the fraction are dropped.
 */
export function fromBaseUnits(amount: bigint, decimals: number): string {
  checkDecimals(decimals);
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}
