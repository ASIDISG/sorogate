#!/usr/bin/env bash
# Checks that the SDK can be used by someone else before it is published: it packs the package, installs the tarball into an
# empty project, and imports it, from the root and from `/model`. It needs the SDK to have been built (`npm run build`).
#
#   scripts/check-pack.sh
#
# The model entry point must not export anything that talks to a network, so that a web page importing it does not ship the
# Stellar SDK.
set -euo pipefail

ROOT="${SOROGATE_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -d "$ROOT/packages/sdk/dist" ] || { echo "the SDK is not built: run 'npm run build -w @sorogate/sdk' first" >&2; exit 1; }

cd "$ROOT"
npm pack -w @sorogate/sdk --pack-destination "$TMP" >/dev/null
cd "$TMP"
npm init -y >/dev/null
npm install --silent ./sorogate-sdk-*.tgz

node --input-type=module -e "
import * as sdk from '@sorogate/sdk';
import * as model from '@sorogate/sdk/model';

for (const name of ['evaluate', 'validateConditions', 'evaluateOnChain', 'getPolicy', 'fetchSnapshot', 'prepareCreatePolicy', 'submitSigned']) {
  if (typeof sdk[name] !== 'function') throw new Error('the root entry does not export ' + name);
}
for (const name of ['evaluate', 'validateConditions', 'toBaseUnits', 'explainDecision']) {
  if (typeof model[name] !== 'function') throw new Error('the model entry does not export ' + name);
}
for (const name of ['evaluateOnChain', 'getPolicy', 'fetchSnapshot', 'prepareCreatePolicy', 'submitSigned']) {
  if (name in model) throw new Error('the model entry exports ' + name + ', which talks to a network');
}
console.log('ok: the packed SDK installs and imports (' + Object.keys(sdk).length + ' exports from the root, ' + Object.keys(model).length + ' from /model)');
"
