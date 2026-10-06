# Testnet smoke run, 2026-10-06

**Label: Recorded.** One manual run of the contract on Stellar Testnet, with throwaway tokens. It checks that the
real network behaves as `spec/SPEC.md` says, including two cases the unit tests cannot reproduce. It is not a
test that CI runs. It will be replaced by a reproducible test once the TypeScript SDK exists.

| | |
| --- | --- |
| Network | Testnet, protocol 29 |
| Contract | `CAKCXAV226WTYNOSYLILAPXGXEN66PZGJ2DJP2FI3ZO2TPQQ4QOHL22E` (throwaway deployment, safe to ignore) |
| WASM | `access_policy.wasm`, 11,457 bytes, sha256 `f702e9d267262ab3f9548fa62021b4c31bb5b5f4f3652ff713906dcd48906814` (the on-chain hash equals the local build) |
| Built with | `stellar contract build`, stellar-cli 27.1.0, soroban-sdk 28.0.0, Rust 1.96 |
| Tokens | Testnet asset contracts for classic assets issued by a throwaway account, and small mock tokens |
| Source | the working tree on this date (no commit yet) |
| Script | a one-off Node script, not kept in the repository |

## What was checked and what happened

**Rejected when written** (simulation): an empty list, a `G` account as a token, a `C` address with nothing
deployed, a `G` account as an NFT collection, `min = 0`, and a time window with no bounds all failed with the
error codes in the spec (2, 6, 6, 6, 4, 5).

**Decisions on the real network**

| Situation | Result |
| --- | --- |
| Window open, asset contract holder, NFT shape holder | allowed, version 1 |
| Account with **no trustline** for the asset | denied, condition 1, `BalanceUnavailable` (the asset contract raises an error rather than returning 0) |
| A `G` account that does not exist | denied, `BalanceUnavailable` |
| A `C` address with no balance | denied, `BelowMinimum` |
| After `update` raising the minimum above the holder's balance | denied, version 2, condition 0, `BelowMinimum` |
| After `set_active(false)` | denied, `Inactive`, no failed index |
| Window starting in an hour / ended an hour ago | `BeforeWindow` / `AfterWindow` |
| Unknown policy id | error 1 (`PolicyNotFound`), not a denial |
| `get` | returns owner, version, active flag and conditions |
| `bump` by the owner key | succeeded |

## Cost of `evaluate` (simulation, subject holds everything)

Transaction limit is 400,000,000 instructions. Small mock WASM tokens are a floor for real tokens.

| Policy | Instructions | Read-only entries | Min fee (stroops) |
| --- | --- | --- | --- |
| 1 time window | 583,197 | 3 | 13,927 |
| 1 asset contract | 665,204 | 4 | 14,193 |
| 1 mock WASM token | 891,678 | 5 | 14,509 |
| 8 asset contracts | 1,441,787 | 11 | 16,202 |
| 8 mock WASM tokens | 3,232,351 | 12 | 17,612 |
| 8 mixed (window, 3 asset, 3 WASM, 1 NFT shape) | 2,252,132 | 11 | 16,717 |

Derived: about 111,000 instructions per added asset-contract condition and about 334,000 per mock WASM token.
Eight conditions use under 1% of the instruction limit.

## What this does not show

Anything on Mainnet; a large production-style token; behaviour under load or across many subjects; the archived
(restore) path; and a consumer contract calling `evaluate` inside its own transaction.
