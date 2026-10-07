# The reference consumer, end to end on Testnet, 2026-10-07

**Label: Recorded.** One manual run of `packages/sdk/scripts/testnet-gated-claim.ts` against the **public Testnet
deployment** of the policy contract ([`../DEPLOYMENT.md`](../DEPLOYMENT.md)). Raw output, including the hashes of
every transaction and the raw failure data: [`testnet-gated-claim-2026-10-07.json`](testnet-gated-claim-2026-10-07.json).
It is not part of CI, because it uses a public network.

Every step is labelled with what kind of evidence it is:

| Label | Meaning |
| --- | --- |
| **Transaction** | Sent to the network and applied. A transaction can be applied and *fail*: that is a real refusal, with a real error code, and is what the failure rows below are |
| **Simulation** | Asked of the network without applying anything. The same code runs, but nothing happens on the ledger |
| **Reading** | A value read from the network |

## Result

**All 26 steps happened as expected.** Each step records what was expected before it ran and what happened.

The three refusals that matter were **applied and failed on the network**, not simulated:

| What was sent | How it ended | Evidence |
| --- | --- | --- |
| A claim by an address that was eligible when the claim was signed, sent **after the policy owner raised the minimum** (consumer follows the policy) | Failed with the consumer's own error `BelowMinimum` (contract error 11). Nothing was paid and no claim was recorded | `4e79b765426d12b2aa78a10bd4c3216c24f556a43a174c78257720a6ac0f85ed` |
| The same address's claim to the consumer **pinned to version 1**, sent after the policy changed | Failed with `PolicyChanged` (contract error 3). The pin was checked before eligibility | `bbef3f282d66aa030fc7290d6688f38c8aa8908fd45ed04806b5df4d9afd8103` |
| A claim for an eligible address **signed by someone else** | Failed with a host **authorization error** (`auth: invalid_action`, "failed account authentication", escalated from `require_auth`). No consumer error code appears: the call never reached the policy decision | `79d9973228684fa9feeca608d37abda51eec8f6d3bd3507d4faa40ef850e1028` |

The raw result and diagnostic events of the last one are in the JSON, under `failedTransactions.signedBySomeoneElse`.

## What it shows about authentication and authorization

The policy contract answers whether an address **qualifies**. It does not prove **who is asking**. Both facts are on the
record here, with the same address:

1. Dave was **eligible**: the policy allowed him (simulation, step "dave is eligible").
2. Bob signed and sent a claim **for Dave**. It **failed**, because the consumer calls `subject.require_auth()` first and
   Dave had not authorized it. Dave was not marked as claimed and was not paid.
3. Dave then claimed **for himself**, in the same state, and was paid (transaction).

So the consumer enforces the policy's decision, and it separately enforces that the caller is the subject.
The policy contract alone would have answered "allowed" for Dave whoever asked.

## Exact call path

`consumer.claim(subject) -> subject.require_auth() -> policy.try_evaluate(policyId, subject) -> pinned-version check -> decision -> record claim -> reward.transfer`

## The run, step by step

| Kind | What was done | What happened | Transaction |
| --- | --- | --- | --- |
| Reading | the policy contract is the public deployment, and the code the network holds is this repository's build | identical |  |
| Transaction | alice (150 of the token, minimum 100) claims on the consumer that follows the policy | paid | `a6fab1460aaefb8f152188d4de1db2f692acc0a65fb244e6e66018da0bc59d33` |
| Reading | alice now holds the reward | 10 SGR |  |
| Reading | the consumer remembers alice claimed | true |  |
| Simulation | alice claims a second time | AlreadyClaimed |  |
| Simulation | carol (50 of the token) claims | BelowMinimum |  |
| Transaction | erin (150) claims on the consumer pinned to version 1, while the policy is at version 1 | paid | `5ec69364a67ba7f900f951030006dbdb6a8546d503a67a3e5318e72cb7acdcef` |
| Reading | erin now holds the reward | 10 SGR |  |
| Reading | the pinned consumer remembers erin claimed | true |  |
| Transaction | the owner updates the policy (a normal transaction) | done | `f2844121dfdce93a55688525d6f16e9aff699e0d2335a29b14fe62822f603c9d` |
| Transaction | bob's claim, signed under version 1, is sent now to the consumer that follows the policy | FAILED: BelowMinimum (contract error 11) | `4e79b765426d12b2aa78a10bd4c3216c24f556a43a174c78257720a6ac0f85ed` |
| Transaction | bob's claim, signed under version 1, is sent now to the consumer pinned to version 1 | FAILED: PolicyChanged (contract error 3) | `bbef3f282d66aa030fc7290d6688f38c8aa8908fd45ed04806b5df4d9afd8103` |
| Reading | the refusals did not pay bob | 0 SGR |  |
| Reading | nor mark him as claimed on the consumer that follows the policy | false |  |
| Reading | nor on the pinned consumer | false |  |
| Transaction | bob (now 600) claims on the consumer that follows the policy | paid | `c4b031121872be1481c592ee7dd086fd47db0cdd3ca9351d0d32aa0fa4528007` |
| Reading | bob now holds the reward | 10 SGR |  |
| Simulation | bob, eligible under version 2, claims on the pinned consumer | PolicyChanged |  |
| Simulation | dave is eligible: the policy would allow him | ok |  |
| Transaction | bob signs and sends a claim for dave | FAILED with an authorization error | `79d9973228684fa9feeca608d37abda51eec8f6d3bd3507d4faa40ef850e1028` |
| Reading | dave has not been marked as claimed | false |  |
| Reading | dave has not been paid | 0 SGR |  |
| Transaction | dave claims for himself, in the same state | paid | `20710f73d9895d1b425e247c95f07fa006aa26f7e43d65c3b20dc004eefebb7b` |
| Reading | dave now holds the reward | 10 SGR |  |
| Reading | the consumer that follows the policy paid out three claims | 70 SGR |  |
| Reading | the pinned consumer paid out one claim | 90 SGR |  |

## How it was done

| | |
| --- | --- |
| Network | Stellar Testnet, protocol 29 (the script refuses any network that does not report the Testnet passphrase) |
| Run | 2026-10-07T13:53:58.378Z |
| Policy contract | `CACR5H46E7VKEDJUWRLKZPJPQVPRHTRTJHZOMQLEIHMTXN4MW7O47YQW`, the public deployment. The script first compared the code the network holds for it with the local build: identical (sha256 `f702e9d2…8906814`) |
| Policy | id `2`: hold at least 100 of the test token, then raised by its owner to 500 (version 2). It is owned by a discarded key, so it stays at version 2 and cannot be changed or deactivated. Policy id 1 on the same contract is from an earlier run the same day that was stopped by a bug in the script's failure-code reading (23 of 26 steps matched; the transactions themselves behaved as here); it is likewise frozen |
| Consumers | Two instances of `gated-claim` (sha256 `143a6b5c…3095334`): `CBJP6MZDUOOG6BCD6FHBOSXX4YMYJDDGS5A3YOGMSAOGTKEC7UAPEQDZ` follows the policy; `CC4MU6FDDKZLBQCHSIHXFZ5QE2C5XK3ET6RTMXV5Q6DWCIEAERBUPGVX` is pinned to version 1 |
| Test token | `CCKMPAYBO4M2UMWHUZEBFWKYUJBP3QRAW3L43SUULRS4RKA4WPJY6XY7`, the `mock-token` **test fixture** (anyone can set any balance on it), sha256 `89146b0e…40922f3` |
| Reward | `CB6HJ2Q4MS2NBMGMKAAHDX4R4WKYFMQDCTOUPV5C3SXWWQ46QDEOU57H`, a real Stellar asset contract for a test asset; each consumer's pool was 100 units and the reward is 10 units |
| Accounts | policy owner and deployer `GAYLY6BN5QUFFT2XPH2762PBPIV43KJYN3NXX4K2ARR2MAP7EH5K44K3`; alice `GC4GT5FLMWEVXI6GMSGJVSONAAHQ4FPLMI44EENZTXEAZXEL26MA336S`; bob `GBU4LB5EWVZC3AIRVGXGXPY7JJF7CKM4QNLO6ISY5YJE467OOED755IM`; carol `GCUBB3LDABGWIWJNNOPHTQ4OYLHPQVEXZA6J2FFV6KQOA3E6VRTYLZ5L`; dave `GDY6H6TVSWPKO2C3V6HHK6JRJRSY7TZ25XNHEWZ6P4SW2E2IX746ANFP`; erin `GB3FCPA5LY7WJP3RMSNJML5BRTVYBE6AGUNHPQ573LMSK6T4H5VQI5IR`. All throwaway accounts funded by friendbot, with their secret keys never printed or saved. Each has a trustline for the reward asset |

## What it does not show

- **Contract accounts (`C...`) as subjects** were not tried. Every subject was an ordinary account.
- **One policy shape.** One `TokenBalance` condition over a test fixture token. Several conditions and the other
  condition types are covered by the differential evidence, and a real collection and a full-size token are the subject
  of their own notes, not this one.
- **The refusals were produced by changing the policy under a signed claim.** That is a faithful way to make the
  consumer refuse a real transaction, but it is a constructed sequence, not an organic one.
- **The error codes were read from the diagnostic events the RPC server returned** for the failed transactions, not from
  anything the network guarantees to keep. A different RPC server might not return them.
- **Nothing here shows how a consumer behaves when a claim record, the consumer instance or its code is archived**, or
  what happens when a claim's lifetime runs out. The claim record is extended for 90 days; that is unit-tested, not
  observed on the network.
- **Time windows and an inactive policy** were not exercised here.
- It is one run (plus the earlier partial one). It found nothing wrong with the contracts, which does not show that
  nothing is wrong.
