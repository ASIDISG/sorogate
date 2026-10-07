# Issues backlog

Candidate issues, each written to be posted to GitHub as-is. Every entry states the current state at a specific commit,
what to build, how to verify it, and what is out of scope. The sizes (Trivial / Medium / High) follow
[`CONTRIBUTING.md`](CONTRIBUTING.md). If you pick one up, comment on the issue first so two people do not build the
same thing. Entries marked **Posted on GitHub** are open issues: comment there, not here. The rest are candidates that
have not been posted yet.

Audited commit: `b7a903b`

Every entry is a gap that can be pointed at in the code or in the recorded evidence. The list is not meant to grow to a
target size: an entry that stops being true is removed.

---

### 1. Record why a claim signed by someone else fails, and run the pinned consumer's payment for real
**Size:** Trivial
**Posted on GitHub:** #5

**Description**
The recorded run of the reference consumer on Testnet
([`docs/evidence/testnet-gated-claim-2026-10-07.md`](docs/evidence/testnet-gated-claim-2026-10-07.md)) has two soft
spots that its own "what it does not show" section admits.

**Current state**
In `packages/sdk/scripts/testnet-gated-claim.ts`, the step where one account signs a claim for another account that is
eligible but did not authorize it treats **any** failure as `rejected` (a bare `catch`). The reason is not recorded; the
note argues it was the missing authorization because the same call succeeded when the account signed it itself. Also,
the consumer pinned to version 1 is only *simulated* (`claimOutcome` answers `ok`), never paid for real.

**What to build**
(a) When the signed-by-someone-else transaction fails, read the transaction's result and record the failure code, and make
the step expect an authorization failure specifically. (b) Before the owner changes the policy, make a different address
claim on the pinned consumer as a real transaction and check it is paid. Re-run the script on Testnet and update the
evidence note and JSON.

**Acceptance criteria**
- [ ] The step fails if the transaction is rejected for any reason other than missing authorization, and the recorded
      report shows the code.
- [ ] A real payment from the pinned consumer is part of the recorded run.
- [ ] The evidence note no longer lists these two items under "what it does not show".

**Out of scope**
Changing the contract. This is about what the run records.

---

### 2. Make the Testnet comparison exercise the allowed path
**Size:** Trivial
**Posted on GitHub:** #6

**Description**
In the recorded comparison of the contract with the TypeScript model, only a few decisions were "allowed", so that run
says little about the path where everything holds.

**Current state**
[`docs/evidence/testnet-differential-2026-10-07.md`](docs/evidence/testnet-differential-2026-10-07.md): 5 of 120 decisions
were allowed (`None`). `randomConditions` in `packages/sdk/scripts/testnet-differential.ts` aims minimums near a
subject's balance, but with up to six random conditions most policies fail somewhere. The offline random test covers the
allowed path far better, but the live path is where the RPC, encoding and real tokens are involved.

**What to build**
Change how policies are generated so that a meaningful share (about a quarter) of decisions are allowed: for example,
for part of the policies, build every condition so that a chosen subject satisfies it. Print the share of allowed
decisions in the summary. Re-run and record.

**Acceptance criteria**
- [ ] The summary reports the number of allowed decisions, and a recorded run has at least 25% of them.
- [ ] Still no disagreement, or a clear explanation of any.
- [ ] The evidence note is updated, including its "what it does not show" section.

**Out of scope**
Larger sample sizes (a separate question).

---

### 3. Add contract-account subjects to the Testnet comparison
**Size:** Medium

**Description**
Subjects can be classic accounts (`G...`) or contract accounts (`C...`). The Testnet comparison only uses classic
accounts, so the contract-account path (including a Stellar asset contract's balance for a contract, which needs no
trustline) is not exercised live.

**Current state**
`SUBJECT_NAMES` in `packages/sdk/scripts/testnet-differential.ts` is `holder`, `nonholder`, `ghost1`, `ghost2`, all
classic account keys. The earlier smoke run
([`docs/evidence/testnet-smoke-2026-10-06.md`](docs/evidence/testnet-smoke-2026-10-06.md)) checked one empty contract
address only.

**What to build**
Add at least two contract-address subjects: one holding a balance on the test tokens and on the Stellar asset contract
(for example by transferring the asset to a deployed contract), one with nothing. Include them in the comparison.

**Acceptance criteria**
- [ ] The comparison includes contract-account subjects, and the summary shows how many.
- [ ] A recorded run shows agreement, or a clear explanation of any disagreement.
- [ ] The evidence note is updated.

---

### 4. Measure a large real token and write `docs/COSTS.md`
**Size:** Medium
**Posted on GitHub:** #2

**Description**
The cost figures in the repository come from a 1.4 KB test token and from Stellar asset contracts. A production token is
much larger, and starting a larger contract costs more, so the figures are a floor. The limit of 8 conditions was chosen
without a measurement of a heavy token.

**Current state**
[`docs/evidence/spike-2026-10-06.md`](docs/evidence/spike-2026-10-06.md) and
[`docs/evidence/testnet-smoke-2026-10-06.md`](docs/evidence/testnet-smoke-2026-10-06.md) report about 310,000
instructions per small WASM token and 90,000 per asset contract. There is no `docs/COSTS.md`, and no measurement of any
third-party token.

**What to build**
Deploy a real, full-size fungible token (the OpenZeppelin `stellar-contracts` fungible example is a good candidate) on
Testnet, create policies of 1, 2, 4 and 8 conditions over it, and simulate `evaluate`. Record instructions, footprint
entries and minimum fee. Write `docs/COSTS.md` with the table, how to reproduce it, and whether the limit of 8 should
change.

**Acceptance criteria**
- [ ] `docs/COSTS.md` has measured numbers for a heavy token, the method, and a date and network label.
- [ ] A recommendation on `MAX_CONDITIONS`, with the numbers behind it.
- [ ] If the recommendation is to change the limit, that is a separate pull request that follows the rules in
      `CONTRIBUTING.md` for changing behaviour.

**Out of scope**
Changing the contract in this issue.

---

### 5. Test `NftBalance` against a real SEP-50 collection
**Size:** Medium
**Posted on GitHub:** #3

**Description**
`NftBalance` reads `balance(owner)` as a `u32`, which is what OpenZeppelin's SEP-50 implementation returns. SEP-50 is a
draft, and it only says the balance type is "an unsigned integer". Nobody has checked the condition against a real
collection.

**Current state**
The tests use the `mock-token` fixture in its `u32` mode. A collection that returns a `u64` is treated as
`BalanceUnavailable` (tested), so a wider type fails closed. No run uses a real collection.

**What to build**
Deploy a real SEP-50 collection (the OpenZeppelin non-fungible example) on Testnet, mint one to an address, create a
policy with an `NftBalance` condition over it, and compare the contract and the model for a holder and a non-holder.
Record the run.

**Acceptance criteria**
- [ ] A recorded run on Testnet over a real collection, with both implementations agreeing.
- [ ] If the real collection returns anything but a `u32`, say so in the evidence note and open a specification issue
      with the details instead of changing behaviour in the same pull request.

---

### 6. Add dependency advisory scans to CI and pin GitHub Actions by commit
**Size:** Medium
**Posted on GitHub:** #4

**Description**
Dependabot proposes updates, but nothing fails the build when a dependency has a published advisory, and the workflow
actions are referenced by version tag, which a tag move can change under us.

**Current state**
`.github/workflows/ci.yml` has no advisory step. Actions are used as `actions/checkout@v7`, `actions/setup-node@v7` and
`stellar/stellar-cli@v27.1.0`. [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) lists both under "Supply chain" as open.

**What to build**
A CI job that runs `cargo audit` (or `cargo deny`) and `npm audit`, and decide in the pull request whether it blocks a
merge or reports only. Pin each action to a full commit hash with the tag in a comment, and make sure Dependabot still
updates them.

**Acceptance criteria**
- [ ] The job runs on push and on a schedule, and its behaviour on a finding is documented.
- [ ] Every `uses:` line is a commit hash.
- [ ] `docs/THREAT_MODEL.md` is updated to say what now exists.

---

### 7. Check that the deployed contract can be rebuilt from this repository
**Size:** Medium

**Description**
Whoever deploys the contract should be able to check that the code on the network is the code in this repository. For
that, building twice must give the same WASM.

**Current state**
`stellar contract build` prints a hash. A local build and the CI build agree on the WASM **size** for all three contracts
(11,457, 5,248 and 1,572 bytes), but nothing compares the **hashes**, and the recorded runs list the hash of the build
that was deployed.

**What to build**
Print each WASM's sha256 in CI, compare it with a build on another machine, and find out whether the build is
reproducible. If it is, add a CI check and a short `docs/VERIFYING.md` that shows how to verify a deployed contract
against a commit. If it is not, document why and what would be needed.

**Acceptance criteria**
- [ ] A recorded comparison of hashes between at least two environments.
- [ ] Either a CI check plus `docs/VERIFYING.md`, or an explanation of what makes the build differ.

---

### 8. Cache the Rust build in CI
**Size:** Trivial

**Description**
CI takes about four minutes, nearly all of it compiling Rust dependencies from scratch.

**Current state**
The `contracts` job takes about 226 seconds and the `sdk` job about 19 seconds. Node's package downloads are cached
(`cache: npm`); the Rust build output and registry are not.

**What to build**
Cache the cargo registry and build output between runs, keyed on the lockfile and the toolchain version.

**Acceptance criteria**
- [ ] A warm run of the `contracts` job is clearly faster, and the PR shows both timings.
- [ ] A change to `Cargo.lock` or `rust-toolchain.toml` invalidates the cache.
- [ ] The job still builds and tests exactly what it did before.

---

### 9. Find out whether the archived-policy path can be tested
**Size:** Medium

**Description**
A policy nobody touches is archived when its lifetime runs out, and a transaction using it has to restore it first. This
is described in the specification and the threat model but has never been exercised.

**Current state**
The tests check that writes and `bump` extend the lifetime. Nothing checks what `evaluate` does when the policy has
actually been archived and then restored. [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) lists it as not checked.

**What to build**
Find out whether the soroban-sdk test environment can simulate expiry and restoration. If it can, add tests: a decision
is the same before archival and after restoration, and a consumer's claim record cannot be reused after archival. If it
cannot, write down why, and describe a manual Testnet check (the minimum lifetime of a persistent entry is about seven
days).

**Acceptance criteria**
- [ ] Either tests that pass and fail when the lifetime handling is broken, or a written explanation with a manual
      procedure in `docs/evidence`.
- [ ] `docs/THREAT_MODEL.md` is updated accordingly.
