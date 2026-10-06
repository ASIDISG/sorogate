# Sorogate

Reusable **access policies** for Stellar, stored in a Soroban contract and evaluated the same way from
other contracts and from TypeScript.

> **Status: early development. Testnet only. Not audited. Not deployed anywhere yet.**
> Only the policy contract exists today. The TypeScript SDK, the reference consumer contract and the web
> playground are planned and listed under "What is planned".

An access policy is a short list of conditions about an address: *holds at least N of this token*, *holds at
least N of this collection*, *the ledger time is inside this window*. All conditions must hold. A contract (or an
app) asks `evaluate(policy_id, address)` and gets back a decision with the reason when it is a denial. Because the
rules live in one place, an owner can change them without redeploying every contract that depends on them.

## What it is not

- It does **not** prove who is calling. `evaluate` answers for any address anyone passes in, so a contract that
  acts on the answer must also call `address.require_auth()`. See [spec/SPEC.md](spec/SPEC.md) section 8.
- A balance is a snapshot, not an identity: the same tokens can pass the check for different addresses in turn.
- It is not secrecy. Hiding content behind a client-side check does not hide it.
- It is **not** an OpenZeppelin smart-account `Policy` (their `enforce()` panics and may change state; ours returns
  a decision and changes nothing).
- It does not issue or verify credentials. Credentials are an adapter interface planned for the SDK.
- It is not affiliated with or endorsed by the Stellar Development Foundation. "Stellar" and "Soroban" are their
  trademarks.

## What exists

- [`contracts/access-policy`](contracts/access-policy): the contract (`create`, `update`, `set_active`, `get`,
  `evaluate`, `bump`) and its tests (27 so far, including a Stellar asset contract and deliberately broken tokens).
- [`spec/SPEC.md`](spec/SPEC.md): the rules, including the failure cases that were measured on Testnet.
- [`docs/evidence/`](docs/evidence): recorded runs against Testnet, each labelled with what it does and does not show.

## What is planned

In this order: shared test vectors and a TypeScript evaluator that must agree with the contract; a live
comparison of the two on a local network; a reference consumer contract; a small Astro site that teaches it; and
a threat model and integration guide. Nothing is promised beyond that, and nothing is called useful until a
contract nobody here wrote depends on it.

## Build and test

You need Rust (with the `wasm32v1-none` target) and the [Stellar CLI](https://github.com/stellar/stellar-cli)
25.2 or newer. Contracts built with soroban-sdk 28 must be built with `stellar contract build`; a plain
`cargo build` is refused.

```bash
cargo test --workspace          # unit tests
stellar contract build          # release WASM
```

On Windows, run the Rust tests inside WSL: native Windows linking of soroban-sdk's test utilities fails.
`scripts/wsl-test.sh` and `scripts/wsl-check.sh` (format, clippy, tests, WASM build) keep build output on the
Linux filesystem.

## Licence

Apache-2.0, see [LICENSE](LICENSE).
