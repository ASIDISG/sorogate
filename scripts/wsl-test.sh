#!/usr/bin/env bash
# Runs the Rust tests from WSL with build output on the Linux filesystem (fast, and avoids the native
# Windows linker problem with soroban-sdk testutils). Usage: scripts/wsl-test.sh [cargo test args]
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/sorogate-target}"
cargo test --workspace "$@"
