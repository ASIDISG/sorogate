# Credentials

Status: **a finding and a seam, not a feature.** Nothing in this repository checks a credential. This page records why
credentials are not a condition of a policy, and what plugging one in would look like.

## The question

The first design decision was that credentials stay an **adapter**, and that before defining the adapter someone should
check whether the credential verifiers that already exist can actually implement it. That was checked on 2026-10-07 by
reading the source of two of them.

## What the two verifiers look like

| | `stellar-zkident` | StellarCred |
| --- | --- | --- |
| Source read | `contracts/credential_verifier/src/lib.rs` at `17ab675` (2026-09-17) | `contracts/proof_registry/src/lib.rs` in a fork at `35e2325` (2026-07-29) |
| Question it answers | `has_credential(user: Address, credential_type: String) -> bool` | `check_claim(holder: Address, credential_type: Symbol, min_threshold: Option<u64>, trusted_issuers: Option<Vec<Address>>) -> bool`, and `is_verified(holder, credential_type: Symbol, trusted_issuers) -> (bool, u64, u64)` |
| Credential name is a | `String` | `Symbol` |
| Extra inputs | none | an optional minimum threshold and an optional list of trusted issuers |
| Answer | a boolean, true while the proof has not expired | a boolean (`check_claim`), or whether it is valid plus when it was verified and when it expires |

This is what the source says, read by a person. It was not run, and the StellarCred fork may differ from the original
project.

## What follows

**Off chain, an adapter is feasible.** Both can answer "does this address hold a credential of kind K right now?" with
yes or no. A small adapter per verifier, which knows that verifier's function name and how it spells the credential kind,
can implement one interface:

```ts
interface CredentialSource {
  hasCredential(subject: string, kind: string): Promise<boolean>;
}
```

This is exported from the SDK as a type (`CredentialSource`). No adapter is included, because each would depend on a
contract this project does not control, and nobody has asked for one yet.

**On chain, a uniform condition is not possible without special-casing each verifier.** A condition inside the policy
contract would have to make a cross-contract call, and these two verifiers differ in function name, in the type of the
credential name, in extra parameters and in what they return. A condition type that fits both would have to carry a
verifier-specific call shape, which turns the policy into a small language for calling other contracts. That is exactly
the arbitrary external call the project decided not to build, and it would make every verifier a place where an
unexpected failure aborts the whole evaluation (see [`THREAT_MODEL.md`](THREAT_MODEL.md)).

So credentials stay **adapter-only**: a consumer or app that cares asks the policy contract and the credential verifier
as two separate questions and combines the answers itself.

## Rules for anything that implements the interface

- A verifier that cannot answer must **throw**, not return `false`. A failure to check must not look like "does not hold
  it". This is the same fail-closed rule the policy contract follows for balances.
- Combining the two answers is the caller's job, and the caller must authenticate the subject first, exactly as for a
  policy ([`INTEGRATING.md`](INTEGRATING.md)).
- Whether a credential is still valid (expired, revoked) is the verifier's responsibility. The adapter only asks.

## Not done

No adapter, no recorded run against a live verifier, and no test that either verifier's function behaves as its source
reads. Anyone who writes an adapter should record that, as the other notes in `docs/evidence` do.
