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

  it('shows no number in the proof strip that was typed into the page', () => {
    // The strip reads its numbers from the vectors and the recorded runs when the site is built, so none can go stale.
    expect(page).not.toMatch(/data-count="\d/);
    expect(page).toContain('data-count={item.value}');
    expect(page).toContain('testnet-differential-2026-10-07.json');
  });

  it('shows the Testnet contract from the deployment record, and no address typed into the page', () => {
    // A Stellar contract address is a C followed by 55 more letters and digits. None may be written into the page: the
    // code samples and the deployment facts read it from docs/deployments/testnet.json, so they cannot drift from it.
    expect(page).not.toMatch(/\bC[A-Z2-7]{55}\b/);
    expect(page).toContain('deployment.contract.id');
    expect(page).toContain('const policyContract = deployment.contract.id');
    expect(page).toContain("contractId: '${policyContract}'");
  });

  it('puts the call, then the deployment, before the proof, in the order of a first visit', () => {
    const at = (id: string): number => page.indexOf(`id="${id}"`);
    expect(at('call')).toBeGreaterThan(-1);
    expect(at('call')).toBeLessThan(at('deployment'));
    expect(at('deployment')).toBeLessThan(page.indexOf('aria-labelledby="proof-heading"'));
  });
});
