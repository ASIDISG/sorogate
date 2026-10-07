import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import deployment from '../../../docs/deployments/testnet.json';

const read = (path: string): string => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('the recorded Testnet deployment', () => {
  it('is a development deployment on Testnet, labelled as a live reading, with no administrator', () => {
    expect(deployment.label).toBe('Live');
    expect(deployment.network.passphrase).toBe('Test SDF Network ; September 2015');
    expect(deployment.purpose).toMatch(/not a production deployment/i);
    expect(deployment.deployer.note).toMatch(/no administrator/i);
  });

  it('has a well-formed contract address, WASM hash and transaction hashes', () => {
    expect(deployment.contract.id).toMatch(/^C[A-Z2-7]{55}$/);
    expect(deployment.wasm.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(deployment.transactions.upload).toMatch(/^[0-9a-f]{64}$/);
    expect(deployment.transactions.create).toMatch(/^[0-9a-f]{64}$/);
    expect(deployment.source.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('is the same deployment that the notes and the evidence name, so they cannot drift apart', () => {
    const notes = read('docs/DEPLOYMENT.md');
    for (const fact of [
      deployment.contract.id,
      deployment.wasm.sha256,
      deployment.transactions.upload,
      deployment.transactions.create,
      deployment.source.commit,
      deployment.deployer.publicKey,
    ]) {
      expect(notes, fact).toContain(fact);
    }
  });

  it('is never described as production anywhere the deployment is mentioned', () => {
    const notes = read('docs/DEPLOYMENT.md');
    expect(notes).toMatch(/not a production deployment/i);
    const readme = read('README.md').replace(/\n>\s?/g, ' ');
    expect(readme).toMatch(/not a\s+production deployment/i);
  });
});
