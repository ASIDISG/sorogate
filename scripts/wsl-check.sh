#!/usr/bin/env bash
# Format check, clippy, tests and the release WASM build, from WSL. Usage: scripts/wsl-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/sorogate-target}"
echo "== cargo fmt --check";  cargo fmt --all -- --check
echo "== cargo clippy";       cargo clippy --workspace --all-targets -- -D warnings
echo "== cargo test";         cargo test --workspace
echo "== stellar contract build"; stellar contract build
