import { describe, expect, it } from 'vitest';

import { decide, type DeploymentRecord } from '../scripts/check-deployed-wasm.js';

const record: DeploymentRecord = {
  wasm: { sha256: 'a'.repeat(64), sha256WithoutCliVersion: 'b'.repeat(64) },
  source: { commit: '1e94264549a220a80d97347386042810f48e47ba' },
};

describe('the deployed-contract check', () => {
  it('passes when the build is the deployed file', () => {
    expect(decide({ sha256: record.wasm.sha256, sha256WithoutCliVersion: record.wasm.sha256WithoutCliVersion }, record, false).ok).toBe(true);
  });

  it('passes when only the CLI version differs', () => {
    const verdict = decide({ sha256: 'c'.repeat(64), sha256WithoutCliVersion: record.wasm.sha256WithoutCliVersion }, record, false);
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toMatch(/CLI version/);
  });

  it('passes, with a note, when the contract has changed since the deployment', () => {
    const verdict = decide({ sha256: 'c'.repeat(64), sha256WithoutCliVersion: 'd'.repeat(64) }, record, true);
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toMatch(/older version/);
    expect(verdict.message).toContain('1e94264');
  });

  it('FAILS when the sources are unchanged but the code differs: that is the case the check exists for', () => {
    const verdict = decide({ sha256: 'c'.repeat(64), sha256WithoutCliVersion: 'd'.repeat(64) }, record, false);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/NOT changed/);
  });

  it('does not let a matching code hide behind changed sources', () => {
    // The sources changed, but the build still equals the deployment: nothing to note.
    const verdict = decide({ sha256: record.wasm.sha256, sha256WithoutCliVersion: record.wasm.sha256WithoutCliVersion }, record, true);
    expect(verdict.message).toMatch(/byte for byte/);
  });
});
