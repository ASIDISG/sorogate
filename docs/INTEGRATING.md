# Using an access policy from your contract

A working example with tests is [`contracts/gated-claim`](../contracts/gated-claim). This page explains the pattern
and what can go wrong. The rules are in [`spec/SPEC.md`](../spec/SPEC.md).

## The pattern

Four steps, in this order:

```rust
pub fn claim(env: Env, subject: Address) -> Result<(), Error> {
    // 1. Prove the caller is the subject.
    subject.require_auth();

    // 2. Ask the policy. Failing to get an answer is a refusal.
    let decision = match PolicyClient::new(&env, &config.policy_contract).try_evaluate(&config.policy_id, &subject) {
        Ok(Ok(decision)) => decision,
        _ => return Err(Error::PolicyUnavailable),
    };

    // 3. Optionally, refuse a policy that is not the version you reviewed.
    if let Some(pinned) = config.pinned_version {
        if decision.version != pinned { return Err(Error::PolicyChanged); }
    }
    if !decision.allowed { return Err(/* say why, from decision.reason */); }

    // 4. Record what you are about to do, then do it.
    /* ... */
}
```

You do not depend on the policy contract's code. Declare the interface you call:

```rust
#[contractclient(name = "PolicyClient")]
pub trait PolicyInterface {
    fn evaluate(env: Env, id: u64, subject: Address) -> Decision;
}
```

with `Decision { allowed: bool, version: u32, failed_index: Option<u32>, reason: DenyReason }` and `DenyReason` as the
integer enum in [`spec/SPEC.md`](../spec/SPEC.md) section 5. [`gated-claim/src/lib.rs`](../contracts/gated-claim/src/lib.rs)
has both, and its tests run against the real policy contract, so a mismatch would fail there.

## What goes wrong

**Skipping step 1.** `evaluate` answers for any address it is given. It does not prove who is calling. A consumer
that never calls `subject.require_auth()` lets anyone act for every qualifying address. The example has a test for
exactly this.

**Treating "no answer" as "yes".** An unknown policy id, a wrong contract address, or a failure inside the policy
all make the call fail. Treat every failure as a refusal (`_ => return Err(...)` above, never a default of allowed).

**Trusting the policy owner without knowing it.** The owner of a policy can change its rules at any time, and the
version in the decision changes with every update. A consumer that must not follow such changes pins the version
(step 3). A consumer that does trust the owner leaves it unpinned. Decide which one you are, on purpose. Check the
pin before you look at the answer, so a changed policy is reported as changed.

**Recording after paying.** Record first, then act, so that if the action fails the whole call reverts, record
included. The example has a test where the pool is empty: the claim fails and leaves nothing behind.

**A balance is a snapshot, not a person.** The same tokens can satisfy a policy for one address, move, and satisfy
it for another; a flash loan can satisfy it for one transaction. A policy over balances cannot tell you that one
human claimed once. If that matters, a per-address flag (as in the example) is not enough on its own.

**The policy owner chooses the tokens.** A token that burns its whole budget makes your transaction abort, and
nothing can catch it. Only use policies whose owner you trust, and keep the number of conditions small.

**Time near a window edge.** A simulation sees the latest closed ledger; your transaction is applied in a later one
(a few seconds on). The contract's answer when the transaction runs is the authoritative one.

**`BalanceUnavailable` is not an outage.** For a classic asset, an account with no trustline makes the asset contract
raise an error, which the policy reports as `BalanceUnavailable`. It usually means "does not hold this asset".

**Lifetime.** A policy that nobody touches is archived after its time to live runs out. A transaction that uses it
must restore it first; the RPC simulation adds that for you. Anyone can call `bump(id)` to extend it. Nothing is
lost, but a consumer that depends on a policy may want to bump it now and then.

## Combining policies

An access policy is a list of conditions that must all hold. Wanting "this OR that" is not something one policy can
say. A consumer could ask two policies and accept either answer. That is a suggestion, not something this
repository implements or tests.

## Testing your integration

Run your contract against the real policy contract in your tests, as `gated-claim` does: register it, create a
policy, and change the policy with `update` to check that your contract follows. Test the failures, not only the
pass: a denied address, an inactive policy, an unknown id, a missing authorization, an empty pool.
