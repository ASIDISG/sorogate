import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SITE, '..', '..');
const page = readFileSync(join(SITE, 'src/pages/index.astro'), 'utf8');

describe('the images the page points at', () => {
  it('exist, and are the ones kept with the project brand files', () => {
    expect(readFileSync(join(SITE, 'public/favicon.svg'))).toEqual(readFileSync(join(ROOT, 'docs/brand/logo.svg')));
    expect(readFileSync(join(SITE, 'public/og.png'))).toEqual(readFileSync(join(ROOT, 'docs/brand/social-preview.png')));
  });

  it('give a preview that is 1280 by 640, as the page says', () => {
    const png = readFileSync(join(SITE, 'public/og.png'));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 640]);
    expect(page).toContain('og:image:width" content="1280"');
    expect(page).toContain('og:image:height" content="640"');
  });

  it('are named in the page head, with the base path and a full address for the preview', () => {
    expect(page).toContain('href={`${base}/favicon.svg`}');
    expect(page).toContain('content={`${site}${base}/og.png`}');
    expect(page).toContain('name="twitter:card" content="summary_large_image"');
  });
});
