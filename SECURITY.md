# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
[private vulnerability reporting](https://github.com/sorogate/sorogate/security/advisories/new) for this
repository. If that page is not available to you, open a public issue that says only "I have a security report"
and a maintainer will arrange a private channel. Do not put details in the issue.

## Status and scope

This project is early and **has not been audited**. It is meant for Testnet. Do not use it with real value.

The contract is the part that matters most. Reports that are especially welcome:

- Any way for someone other than the policy owner to change, deactivate or take over a policy
  (`create`, `update`, `set_active`).
- Any input that makes `evaluate` return a different decision than `spec/SPEC.md` describes, or return `allowed`
  when it should not.
- Any way to store an address that the contract is supposed to refuse (an account address or an empty contract
  address used as a token or collection).
- Anything that makes a policy unreadable or unusable by other contracts (lifetime and archival handling).
- A secret key, token or credential committed to this repository or printed by a script.

Known limits are documented, not vulnerabilities: `evaluate` does not authenticate the subject, a balance is a
snapshot, and a token chosen by a policy owner can exhaust the calling transaction's budget. See
`spec/SPEC.md` section 8.

## Response

This is a small project. A maintainer will acknowledge a report as soon as they can and say plainly what they
can and cannot do. No bug bounty is offered.
