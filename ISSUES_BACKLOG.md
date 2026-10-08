# Issues backlog

Candidate issues, each written to be posted to GitHub as-is. Every entry states the current state at a specific commit,
what to build, how to verify it, and what is out of scope. The sizes (Trivial / Medium / High) follow
[`CONTRIBUTING.md`](CONTRIBUTING.md). If you pick one up, comment on the issue first so two people do not build the
same thing. Entries marked **Posted on GitHub** are open issues: comment there, not here. The rest are candidates that
have not been posted yet.

Audited commit: `9fa36fc`

Every entry is a gap that can be pointed at in the code or in the recorded evidence. The list is not meant to grow to a
target size: an entry that stops being true is removed, and so is one whose issue has been closed. The issue is
the record of that work.

---

### 1. Make the Testnet comparison exercise the allowed path
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

### 2. Add contract-account subjects to the Testnet comparison
**Size:** Medium
**Posted on GitHub:** #7

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

### 3. Cache the Rust build in CI
**Size:** Trivial
**Posted on GitHub:** #11

**Description**
CI takes about three to four minutes, mostly compiling Rust dependencies from scratch.

**Current state**
Over the last four runs the `contracts` job took between 177 and 242 seconds and the `sdk` job about 30. Node's package downloads are cached
(`cache: npm`); the Rust build output and registry are not.

**What to build**
Cache the cargo registry and build output between runs, keyed on the lockfile and the toolchain version.

**Acceptance criteria**
- [ ] A warm run of the `contracts` job is clearly faster, and the PR shows both timings.
- [ ] A change to `Cargo.lock` or `rust-toolchain.toml` invalidates the cache.
- [ ] The job still builds and tests exactly what it did before.

---

### 4. Find out whether the archived-policy path can be tested
**Size:** Medium
**Posted on GitHub:** #12

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
