import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/styles/site.css'), 'utf8');

/** The `--name: #rrggbb;` declarations in a piece of CSS. */
function declarations(block: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) found[match[1] as string] = match[2] as string;
  return found;
}

const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const light = declarations(css.slice(css.indexOf(':root {'), darkStart));
const dark = { ...light, ...declarations(css.slice(darkStart, css.indexOf('* {', darkStart))) };

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function ratio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** [foreground token, background token, the least contrast WCAG asks of that use]. */
const PAIRS: [string, string, number][] = [
  // text
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-2', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'surface-2', 4.5],
  ['brand', 'bg', 4.5],
  ['brand', 'surface', 4.5],
  ['brand', 'surface-2', 4.5],
  ['button-text', 'button', 4.5],
  ['ok-text', 'ok-bg', 4.5],
  ['no-text', 'no-bg', 4.5],
  ['warn-text', 'warn-bg', 4.5],
  // the white text on the hero, over every stop of its gradient
  ['hero-text', 'hero-a', 4.5],
  ['hero-text', 'hero-b', 4.5],
  ['hero-text', 'hero-c', 4.5],
  ['hero-muted', 'hero-a', 4.5],
  ['hero-muted', 'hero-b', 4.5],
  ['hero-muted', 'hero-c', 4.5],
  // marks and borders that carry meaning (WCAG asks 3:1 for these)
  ['ok-accent', 'ok-bg', 3],
  ['no-accent', 'no-bg', 3],
  ['control', 'surface', 3],
  ['control', 'surface-2', 3],
  ['control', 'bg', 3],
];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('the %s theme', (_name, theme) => {
  it('defines every colour the pairs below use', () => {
    for (const [foreground, background] of PAIRS) {
      expect(theme[foreground], foreground).toBeDefined();
      expect(theme[background], background).toBeDefined();
    }
  });

  it('gives every text and every meaningful mark enough contrast', () => {
    const failures = PAIRS.flatMap(([foreground, background, least]) => {
      const got = ratio(theme[foreground] as string, theme[background] as string);
      return got >= least ? [] : [`${foreground} on ${background}: ${got.toFixed(2)}:1, needs ${least}:1`];
    });
    expect(failures).toEqual([]);
  });
});
