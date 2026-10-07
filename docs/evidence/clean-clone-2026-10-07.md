# A new contributor's first hour, 2026-10-07

**Label: Recorded.** A fresh clone of `main` on a machine that had never built this repository (an empty build cache),
following only what `CONTRIBUTING.md` says, with every step timed. WSL 2 on Windows, four threads, working on the Linux
filesystem, Node 22.22.1, Rust 1.96.0, stellar-cli 27.1.0. No Docker, no wallet, no Testnet.

| Step | Result | Time |
| --- | --- | --- |
| `git clone` | ok | 3 s |
| `cargo fmt --all -- --check` | ok | 4 s |
| `cargo clippy --workspace --all-targets -- -D warnings` | ok | 203 s |
| `cargo test --workspace` | ok | 156 s |
| `stellar contract build` | ok, three WASM files | 96 s |
| `npm ci` | ok | 98 s |
| `npm run lint`, `typecheck`, `test`, `build` | ok | 9 s, 8 s, 12 s, 5 s |
| Generate 200 + 200 random cases, then compare the contract with the TypeScript model (the two commands in `CONTRIBUTING.md`) | ok, 2 tests passed | 13 s and 6 s |

About 10 minutes from nothing to a green daily loop, most of it compiling Rust dependencies once.

## The change test

The contract's limit on conditions was raised from 8 to 9 **in the contract only**, as a contributor might by mistake.

- All 27 contract unit tests still passed: the one that checks the limit reads the constant.
- The shared vectors **failed** (`validate_vectors`: the vector that says nine conditions must be refused).
- Reverting the change made everything pass again.

This is the design working as intended: a change to behaviour in one implementation is caught by the vectors even when
its own unit tests agree with it. It also shows a weakness: that unit test follows the constant instead of the number in
the specification.

## What it does not show

One machine and one operating system (Linux under Windows). Not macOS, not native Linux, not native Windows (where the
Rust tests do not link). Not a person reading the guide: it shows the commands work, not that the guide is clear.
Written by the maintainer, not by someone new to the project.

## A note on how this run was prepared

An earlier version of the random-comparison command in `spec/vectors/README.md` was wrong: `--out` was given relative to
the wrong folder (npm runs workspace scripts from `packages/sdk`) and the Rust test needs an absolute path. That was
corrected before this run, and this run used the corrected commands.
