#!/usr/bin/env bash
# Runs the TypeScript checks (install, lint, typecheck, test, build) from WSL on a copy in the Linux
# filesystem, so native packages match what CI installs and the Windows tree keeps no Linux binaries.
# Usage: scripts/wsl-js.sh [--update-lock]   (--update-lock copies the resulting package-lock.json back)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="$HOME/.cache/sorogate-js"
mkdir -p "$DST"
rsync -a --delete --exclude node_modules --exclude dist \
  "$SRC/package.json" "$SRC/package-lock.json" "$DST/" 2>/dev/null || cp "$SRC/package.json" "$DST/"
mkdir -p "$DST/packages" "$DST/spec"
rsync -a --delete --exclude node_modules --exclude dist "$SRC/packages/" "$DST/packages/"
rsync -a --delete "$SRC/spec/" "$DST/spec/"
mkdir -p "$DST/docs"
rsync -a --delete "$SRC/docs/" "$DST/docs/"
cp "$SRC/README.md" "$DST/README.md"   # a site test checks the README against the deployment record
cd "$DST"
if [ "${1:-}" = "--update-lock" ]; then npm install; else npm ci; fi
npm run lint
npm run typecheck
npm test
npm run build
if [ "${1:-}" = "--update-lock" ]; then cp package-lock.json "$SRC/package-lock.json"; echo "lockfile copied back"; fi
