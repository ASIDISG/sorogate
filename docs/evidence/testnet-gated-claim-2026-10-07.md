# The reference consumer, end to end on Testnet, 2026-10-07

**Label: Recorded.** One manual run of `packages/sdk/scripts/testnet-gated-claim.ts`. Raw output, including the
transaction hashes of the real transactions:
[`testnet-gated-claim-2026-10-07.json`](testnet-gated-claim-2026-10-07.json). It is not part of CI, because it uses a
public network.

## Result

**All 18 steps happened as expected.** Each step records what was expected before it ran and what happened; none
differed.

| What was done | What happened |
| --- | --- |
| An address holding 150 of a test token (policy: at least 100) claims | Paid 10 of the reward asset; the consumer records the claim |
| The same address claims again | Refused: `AlreadyClaimed` |
| An address holding 50 claims | Refused: `BelowMinimum` |
| The policy owner raises the minimum to 500 in one ordinary transaction. **Neither consumer is redeployed or touched.** | |
| An address holding 150 claims on the consumer that follows the policy | Refused: `BelowMinimum`. The new rule applies at once. |
| The same address claims on the consumer **pinned to version 1** | Refused: `PolicyChanged` (checked before eligibility) |
| The address is given 600 and claims on the consumer that follows the policy | Paid |
| The same address, now eligible, claims on the pinned consumer | Still refused: `PolicyChanged` |
| A second address, eligible, has a claim submitted for it **signed by someone else** | The transaction failed. The address was not marked as claimed and was not paid. |
| That address then claims for itself | Paid |
| The pool of the consumer that follows the policy | Paid out exactly three claims: 100 minus 30 |

So the central claim of the project was seen working on a real network: a policy owner changed a rule, and a
consumer that nobody redeployed followed it, while a consumer that had pinned the version refused to.

## How it was done

| | |
| --- | --- |
| Network | Stellar Testnet, protocol 29 (the script refuses any network that does not report the Testnet passphrase) |
| Keys | Created by the script in memory and funded by friendbot. Never printed or saved. |
| Contracts | The policy contract (sha256 `f702e9d2…8906814`, the same as in the other recorded runs), the test-token fixture, a real Stellar asset contract as the reward, and two instances of `gated-claim` (sha256 `143a6b5c…c3095334`) |
| Subjects | Four ordinary accounts, each with a trustline for the reward asset |
| Reward | A test asset issued by a throwaway account; each consumer's pool is 100 units |

## What it does not show

- **Refusals are simulations, not failed transactions.** A call that fails in simulation cannot be sent, so every
  refusal above is the result of simulating the call, and every payment is a real transaction. The refusals use the
  same code as a real call would, but no refused transaction was executed on the network.
- **The reason for the failed signed-by-someone-else claim was not recorded.** The script treats any failure of that
  transaction as "rejected". The evidence that the cause was the missing authorization is that the identical call
  succeeded when the address signed it itself, in the same state, a moment later. The unit tests check the
  authorization failure directly.
- The pinned consumer's *paying* path was only simulated (it answered "ok" while the policy was at version 1).
- Subjects were ordinary accounts. **Contract accounts (`C...`)** were not tried.
- A policy with one condition. Policies with several conditions are covered by the differential evidence, not here.
- Only the reward asset's own contract was used to pay: no third-party token, and nothing about archival or what
  happens when a claim's lifetime runs out.
- It is one run. It found nothing wrong, which does not show that nothing is wrong.
