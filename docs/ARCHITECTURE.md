# Architecture

Sorogate lets an owner store an **access policy** on Stellar (a short list of conditions about an address) and lets any
contract or app ask whether an address satisfies it. This page is the map. The rules are in
[`spec/SPEC.md`](../spec/SPEC.md); what can go wrong is in [`THREAT_MODEL.md`](THREAT_MODEL.md).

## The pieces

```
   anyone                 policy owner                  consumer author
     |                         |                              |
     |  asks                   | create / update /            |  calls evaluate()
     |  "does X satisfy        | set_active                   |  inside their own contract
     |   policy 7?"            v                              v
     |                  +-----------------+          +----------------+
     +----------------->|  access-policy  |<---------|  gated-claim   |   (a reference
        (simulation)    |  (the contract) |          |  (a consumer)  |    consumer)
                        +--------+--------+          +----------------+
                                 | balance(address)
                                 v
                        tokens and collections the policy names
                        (other people's contracts)
```

| Where | What it is | Role |
| --- | --- | --- |
| `contracts/access-policy` | The Soroban contract | **The authority.** Stores policies by id, owned and versioned, and answers `evaluate` |
| `contracts/gated-claim` | A Soroban contract | A reference **consumer**: pays once to each address that passes. Shows the pattern in [`INTEGRATING.md`](INTEGRATING.md) |
| `contracts/mock-token` | A Soroban contract | A **test fixture**: a fake token whose behaviour is chosen at deploy time |
| `packages/sdk` | TypeScript | A **model** of the rules (pure functions), and a read-only **client** that asks a deployed contract |
| `spec/SPEC.md` | Prose | The rules |
| `spec/vectors` | JSON | The expected answers, run against both implementations |
| `docs/evidence` | Prose and JSON | Recorded runs on Testnet, each saying what it does not show |

## One evaluation

`evaluate(policy id, subject)` loads the policy, then goes through its conditions **in order and stops at the first one
that does not hold**. A balance condition calls `balance(subject)` on the named token; anything that goes wrong in that
call is a denial (`BalanceUnavailable`), never a pass. A time condition compares the ledger's close time with a window.
The answer says whether it was allowed, which condition failed and why, and **which version of the policy it used**.

It is read-only and needs no authorization, so it does not prove who is asking. A consumer proves that itself, with
`subject.require_auth()`, and only then acts on the answer.

## Two ways to get an answer, and which one counts

1. **Ask the contract** (`evaluateOnChain` in the SDK, or `evaluate` from another contract). This is the answer that counts.
2. **Work it out locally**: read the balances and the ledger time (`fetchSnapshot`, all from one ledger) and run the
   TypeScript model (`evaluate`). Useful for previews and for explaining a denial.

The second exists so that an app can show a result without a transaction. Because it is a second implementation, it can
drift from the first, so the two are held together by tests:

- the **shared vectors** (`spec/vectors`) run against both;
- a **random comparison** generates thousands of policies with the model and checks the real contract agrees, on every push;
- a manual **comparison on Testnet** checks the client path against the deployed contract.

If they ever disagree, the contract wins and the model is the bug.

## Decisions worth knowing

| Decision | Why |
| --- | --- |
| Policies are **stored in the contract, by id** | Another contract can then rely on a policy it did not write, and an owner can change a rule without redeploying every consumer |
| Every decision carries the policy's **version** | A consumer that must not follow rule changes can pin the version |
| **Fail closed** | A token that errors, returns the wrong type or does not exist gives a denial, not a pass |
| Addresses are checked when a policy is **written** | Calling an account address as a contract aborts the whole transaction instead of failing softly. Measured: [`evidence/spike-2026-10-06.md`](evidence/spike-2026-10-06.md) |
| **No owner transfer, no deletion, no administrator, no upgrade path** | There is no key that can take over other people's policies. The price is that a bug fix is a new deployment |
| At most **8 conditions** | Each is a call into code the policy owner chose. Measured costs ([`COSTS.md`](COSTS.md)) would allow far more; the limit keeps a policy reviewable |
| The denial reason is a plain integer field with a `None` value | The SDK cannot convert an optional custom enum inside a stored struct |
| The model is **advisory**, the contract **authoritative** | One answer has to win, and it is the one that runs on the network |

## Not in this version

OR and NOT between conditions, arbitrary external calls, credentials, ownership transfer, batch evaluation, a web
application, and any Mainnet deployment. Credentials would be an adapter interface in the SDK, not logic in the contract.
