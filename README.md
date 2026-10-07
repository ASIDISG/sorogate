# Sorogate

Reusable **access policies** for Stellar, stored in a Soroban contract and evaluated the same way from
other contracts and from TypeScript.

> **Status: early development. Testnet only. Not audited. Not production.**
> The policy contract, a TypeScript model of it, the shared test vectors, a reference consumer and a static
> playground page exist today. The playground is live at https://sorogate.github.io/sorogate/. There is one public
> **development deployment on Stellar Testnet**, described in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). It is not a
> production deployment, and Testnet is reset from time to time. The other Testnet runs in `docs/evidence` used
> throwaway deployments.

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
  `evaluate`, `bump`), with 27 unit tests (including a Stellar asset contract and deliberately broken tokens) and
  a harness that runs the shared vectors.
- [`packages/sdk`](packages/sdk): a TypeScript model of the rules (`validateConditions`, `evaluate`, balance
  decoding), helpers for amounts and for explaining a decision in plain language, and a read-only client that asks a
  deployed contract through an RPC server (`evaluateOnChain`, `getPolicy`, `fetchSnapshot`), and builders for the
  unsigned transactions that create, update and deactivate a policy, for a wallet to sign. It is not published, and the contract, not the model, is the authoritative answer.
- [`packages/site`](packages/site): a static [Astro](https://astro.build) page that works a policy out in the browser with
  the TypeScript model and sets the result beside the answer the contract is recorded as giving. Its examples are the
  shared vectors, and it makes no network calls and holds no keys. It is published at
  <https://sorogate.github.io/sorogate/> by `.github/workflows/pages.yml`.
- [`spec/vectors`](spec/vectors): 70 shared test cases (45 decisions, 25 validity checks). The contract and the
  TypeScript model must both give the expected answer for every one. A seeded generator adds thousands of random
  cases (CI runs four seeds of 1,000 per file) and the contract must agree with the TypeScript model on all of them.
- [`contracts/gated-claim`](contracts/gated-claim): a reference **consumer**. It pays a fixed amount once to each address
  that satisfies a policy, shows the order of checks a consumer should follow, and can pin the policy version. It is
  a demonstration with no withdrawal and no administrator: fund it only with a test asset.
  [`docs/INTEGRATING.md`](docs/INTEGRATING.md) explains the pattern and what goes wrong.
- [`contracts/mock-token`](contracts/mock-token): a **test fixture**, a fake token whose `balance` behaviour is chosen
  at deploy time. Anyone can set any balance on it, so it is for tests only.
- [`spec/SPEC.md`](spec/SPEC.md): the rules, including the failure cases that were measured on Testnet.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and
  [`docs/INTEGRATING.md`](docs/INTEGRATING.md): how the pieces fit, what is and is not protected, and how to use a policy
  from your own contract. [`docs/CREDENTIALS.md`](docs/CREDENTIALS.md) records why credentials are not a condition.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): the public Testnet development deployment of the policy contract (address,
  WASM hash, transactions, date, who controls it: nobody), how to check that it is the code in this repository, and how
  to keep it alive.
- [`docs/evidence/`](docs/evidence): recorded runs against Testnet, each labelled with what it does and does not show,
  including one where the deployed contract and the TypeScript model agreed on 120 comparisons, and one that walks the
  reference consumer through its scenarios on the public Testnet deployment (26 steps, all as expected, including
  refusals that were applied and failed as real transactions, and a claim signed by someone else that failed with an
  authorization error), and one that checks the `NftBalance` condition against a real OpenZeppelin SEP-50 collection
  (29 steps, contract and model agreeing on every comparison). Both used collections or tokens we deployed, not ones
  somebody else operates.

## What is planned

Nothing is promised. Nothing here is called useful until a contract nobody here wrote depends on it.

## Build and test

You need Rust (the version in `rust-toolchain.toml`, with the `wasm32v1-none` target), the
[Stellar CLI](https://github.com/stellar/stellar-cli) 25.2 or newer, and Node 20.11 or newer for the SDK (22.12 or newer for the web page). Contracts built with soroban-sdk 28 must be built with `stellar contract build`; a plain
`cargo build` is refused.

```bash
cargo test --workspace          # contract unit tests and the vectors
stellar contract build          # release WASM
npm ci && npm test              # the TypeScript model and the vectors
```

To compare the contract with the TypeScript model on random policies, see
[spec/vectors/README.md](spec/vectors/README.md).

On Windows, run the Rust tests inside WSL: native Windows linking of soroban-sdk's test utilities fails.
`scripts/wsl-test.sh` and `scripts/wsl-check.sh` (format, clippy, tests, WASM build) keep build output on the
Linux filesystem, and `scripts/wsl-js.sh` does the same for the TypeScript checks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Scoped candidates for new contributors are in
[ISSUES_BACKLOG.md](ISSUES_BACKLOG.md). A security problem goes through [SECURITY.md](SECURITY.md), not a public issue.

## Licence

Apache-2.0, see [LICENSE](LICENSE).
