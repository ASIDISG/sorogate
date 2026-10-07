# The SDK's transaction builders, on Testnet, 2026-10-07

**Label: Recorded.** One manual run of `packages/sdk/scripts/testnet-sdk-writes.ts`. Raw output, including the hashes of
the real transactions: [`testnet-sdk-writes-2026-10-07.json`](testnet-sdk-writes-2026-10-07.json). It is not part of CI,
because it uses a public network.

## Result

**All 11 steps happened as expected.** Each step records what was expected before it ran and what happened.

| What was done | What happened |
| --- | --- |
| `prepareCreatePolicy`, signed by the owner, sent with `submitSigned` | The new policy id came back as `1` |
| The policy was read back | Version 1, active, minimum 100: what was sent |
| `prepareUpdatePolicy` (minimum 500) | Version 2, minimum 500 |
| `prepareSetActive(false)` | Inactive, version still 2; the contract then denied with `Inactive` |
| `prepareSetActive(true)` | Active again, version still 2 |
| A policy with a minimum of 0, handed to `prepareCreatePolicy` | Refused by the SDK before anything was sent (`InvalidPolicyError`) |
| An account address as a token | Refused by the **contract** while the transaction was being prepared (`ContractCallError`, `NotAContract`) |
| An update of a policy that does not exist | `ContractCallError`, `PolicyNotFound` |
| An account that is not the owner signs an update of the owner's policy | **The transaction failed when applied** (`TransactionFailedError`). The policy was unchanged afterwards (version 2, active, minimum 500) |

## How it was done

| | |
| --- | --- |
| Network | Stellar Testnet, protocol 29 (the script refuses any network that does not report the Testnet passphrase) |
| Keys | Two created by the script in memory and funded by friendbot. Never printed or saved. |
| Contracts | The policy contract (sha256 `f702e9d2…8906814`, the same as in the other recorded runs) and the test-token fixture |
| Signing | The script signs with the key it created, standing in for a wallet |

## What it does not show

- **No real wallet was involved.** The script signs the prepared transaction itself. Whether a wallet accepts and
  signs what the builders produce (for example the five-minute validity, the fee, the authorization it shows the user) was
  not tried.
- **The reason the intruder's transaction failed was not recorded.** The step accepts a refusal at either point, and it
  happened when the transaction was applied; the failure code was not read. That the cause was the missing authorization
  is argued from the owner's own identical update, which succeeded earlier in the same run, and from the policy being unchanged.
- The behaviour of `submitSigned` when the network is slow or never confirms (the timeout), and a fee-bump transaction, are
  covered by unit tests with a stand-in server only, not by this run.
- One run, one owner, three kinds of change.
