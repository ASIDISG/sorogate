/**
 * CI check: does the contract this repository builds still match the public Testnet deployment?
 *
 *   tsx scripts/check-deployed-wasm.ts --wasm <built access_policy.wasm> --record <docs/deployments/testnet.json> [--repo <dir>]
 *
 * It needs no network: the deployment record holds the hash of what was deployed, and the git history says whether the
 * contract's sources have changed since the commit it was built from.
 *
 *  - The build is the deployed code (byte for byte, or differing only in the CLI version stamped in the metadata): pass.
 *  - It differs, and the contract sources have changed since the deployment: pass, with a note. The repository has moved on
 *    from what is deployed, which is expected, and the deployment notes then describe an older version.
 *  - It differs although the sources have not changed: FAIL. The same source no longer builds to the same code, so the
 *    claim that the deployment is this repository's code can no longer be checked.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { hashes } from './wasm-identity.js';

export interface DeploymentRecord {
  wasm: { sha256: string; sha256WithoutCliVersion: string };
  source: { commit: string };
}

export type Verdict = { ok: true; message: string } | { ok: false; message: string };

/** The decision, apart from reading files and running git, so it can be tested. */
export function decide(built: { sha256: string; sha256WithoutCliVersion: string }, record: DeploymentRecord, sourcesChangedSinceDeployment: boolean): Verdict {
  if (built.sha256 === record.wasm.sha256) {
    return { ok: true, message: 'The build is byte for byte the deployed contract.' };
  }
  if (built.sha256WithoutCliVersion === record.wasm.sha256WithoutCliVersion) {
    return { ok: true, message: 'The build is the deployed code, differing only in the CLI version stamped in its metadata.' };
  }
  if (sourcesChangedSinceDeployment) {
    return {
      ok: true,
      message: `The contract sources have changed since commit ${record.source.commit.slice(0, 7)}, so the public deployment is an older version. Redeploy and update docs/deployments/testnet.json when that matters.`,
    };
  }
  return {
    ok: false,
    message: `The contract sources have NOT changed since commit ${record.source.commit.slice(0, 7)}, yet the build differs from the deployed code (built ${built.sha256WithoutCliVersion}, deployed ${record.wasm.sha256WithoutCliVersion}). The same source no longer builds to the same code.`,
  };
}

const CONTRACT_INPUTS = ['contracts/access-policy', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'];

function sourcesChangedSince(commit: string, repo: string): boolean {
  try {
    execFileSync('git', ['diff', '--quiet', commit, 'HEAD', '--', ...CONTRACT_INPUTS], { cwd: repo, stdio: 'ignore' });
    return false;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return true;
    throw new Error(`could not compare with commit ${commit}: is the full history checked out?`, { cause: error });
  }
}

function main(): void {
  const flag = (name: string): string => {
    const i = process.argv.indexOf(`--${name}`);
    const value = i >= 0 ? process.argv[i + 1] : undefined;
    if (value === undefined) throw new Error(`missing --${name}`);
    return value;
  };
  const record = JSON.parse(readFileSync(resolve(flag('record')), 'utf8')) as DeploymentRecord;
  const built = hashes(readFileSync(resolve(flag('wasm'))));
  const repo = process.argv.includes('--repo') ? resolve(flag('repo')) : resolve(import.meta.dirname, '../../..');
  // Only look at git when it matters.
  const differs = built.sha256 !== record.wasm.sha256 && built.sha256WithoutCliVersion !== record.wasm.sha256WithoutCliVersion;
  const verdict = decide(built, record, differs ? sourcesChangedSince(record.source.commit, repo) : false);
  console.log(`${verdict.ok ? 'OK' : 'FAIL'}: ${verdict.message}`);
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
