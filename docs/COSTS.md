# Costs

**Label: Recorded, and every figure is Simulated** (see [`EVIDENCE.md`](EVIDENCE.md): the network was asked what each call would
cost, and nothing was applied). Measured on Stellar Testnet (protocol 29), ledger 5,072,495, on 2026-10-07, by
`packages/sdk/scripts/testnet-costs.ts`. Raw data: [`evidence/testnet-costs-2026-10-07.json`](evidence/testnet-costs-2026-10-07.json).
Testnet's fees and limits are its own; this page says nothing about Mainnet.

This page reports what was measured. It does not say Sorogate is cheap or expensive, because that depends on what a
transaction is worth to whoever pays it.

## What was measured and how

- **A simulation by the network, not a spend.** Every figure comes from `simulateTransaction` against a policy
  contract deployed from the same WASM as the [public deployment](DEPLOYMENT.md) (a separate instance, so this run added
  no policies to the public one). Each measurement was taken 3 times; instructions and fee were identical on every
  repeat, so there is no spread to report.
- **Instructions** are what the simulation says the transaction would declare. **Minimum resource fee** is the
  `minResourceFee` it returns, in stroops (1 XLM = 10,000,000 stroops). It includes rent for any lifetime extension, which
  Soroban documents as partly refundable when less is used; it is a minimum to submit with, not a bill.
- **Entries** are the ledger entries in the transaction's footprint: the policy, each token's balance entry, instance
  and code, and so on.
- **Contracts / codes** is how many different contracts a policy names, and how many different WASM files they run.
  Asset contracts (Stellar's built-in token) have no WASM file of their own.
- **Real contracts, ours deployed.** Asset contracts for classic assets; OpenZeppelin's `fungible-pausable` token
  (10,615 bytes) and `nft-sequential-minting` collection
  (15,749 bytes), from `stellar-contracts` v0.7.2. Earlier figures in this repository came from a
  1.4 KB test token. The subject holds enough of everything, so every condition holds and **all of them are read**: the
  most expensive outcome of an `evaluate`, except where noted.
- **Eight different codes.** To measure eight conditions over eight *different* contract codes, each real WASM was
  deployed eight times with a different empty custom section appended, so every copy has its own hash and is loaded on its
  own. That section is data the WebAssembly format sets aside for tools; it does not change what the contract does.
- **Fresh and settled.** The last two columns are the same simulation at two moments. **Fresh** is right after the
  contracts were deployed. **Settled** is after one applied `evaluate` had gone through every contract involved. They
  differ a great deal for OpenZeppelin's contracts; see [Fresh and settled](#fresh-and-settled).

## The network's limits for one transaction

Read from the network's configuration on the same day.

| Limit | Value |
| --- | --- |
| Instructions | 400,000,000 |
| Memory | 41,943,040 bytes |
| Footprint entries | 400 |
| Disk-read entries / bytes | 200 / 200,000 |
| Write bytes | 132,096 |
| Largest contract | 131,072 bytes |
| Longest lifetime extension | 3,110,400 ledgers (about 180 days at five seconds a ledger) |

## `evaluate`, by condition type

Subject holds everything, so every condition is read. Percentages are of the instruction limit.

| Policy | Instructions | Of limit | Entries | Contracts / codes | Fee, fresh (stroops) | Fee, settled (stroops) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 time window | 583,197 | 0.15% | 3 | 0 / 0 | 13,927 | 13,927 |
| 2 time windows | 608,523 | 0.15% | 3 | 0 / 0 | 13,944 | 13,944 |
| 3 time windows | 633,847 | 0.16% | 3 | 0 / 0 | 13,962 | 13,962 |
| 8 time windows | 760,475 | 0.19% | 3 | 0 / 0 | 14,051 | 14,051 |
| 1 asset contract (TokenBalance) | 679,383 | 0.17% | 5 | 1 / 0 | 16,184 | 16,184 |
| 2 asset contracts (TokenBalance) | 803,578 | 0.20% | 7 | 2 / 0 | 18,460 | 18,460 |
| 3 asset contracts (TokenBalance) | 930,135 | 0.23% | 9 | 3 / 0 | 20,737 | 20,737 |
| 8 asset contracts (TokenBalance) | 1,593,408 | 0.40% | 19 | 8 / 0 | 32,148 | 32,148 |
| 1 fungible token, each its own code (TokenBalance) | 1,083,150 | 0.27% | 6 | 1 / 1 | 306,265 | 15,148 |
| 2 fungible tokens, each its own code (TokenBalance) | 1,622,366 | 0.41% | 9 | 2 / 2 | 598,630 | 16,396 |
| 3 fungible tokens, each its own code (TokenBalance) | 2,172,912 | 0.54% | 12 | 3 / 3 | 891,000 | 17,652 |
| 8 fungible tokens, each its own code (TokenBalance) | 4,979,218 | 1.24% | 27 | 8 / 8 | 2,352,863 | 23,968 |
| 1 NFT collection, each its own code (NftBalance) | 1,059,796 | 0.26% | 6 | 1 / 1 | 282,885 | 15,131 |
| 2 NFT collections, each its own code (NftBalance) | 1,573,789 | 0.39% | 9 | 2 / 2 | 551,868 | 16,362 |
| 3 NFT collections, each its own code (NftBalance) | 2,102,804 | 0.53% | 12 | 3 / 3 | 820,860 | 17,603 |
| 8 NFT collections, each its own code (NftBalance) | 4,788,916 | 1.20% | 27 | 8 / 8 | 2,165,824 | 23,835 |
| 8 fungible tokens that share one code (TokenBalance) | 4,839,580 | 1.21% | 20 | 8 / 1 | 2,351,706 | 22,773 |
| 8 conditions naming the same fungible token | 4,335,280 | 1.08% | 6 | 1 / 1 | 308,550 | 17,424 |
| 3 mixed: window, asset contract, NFT collection | 1,206,737 | 0.30% | 8 | 2 / 1 | 285,183 | 17,424 |
| 8 mixed: 2 windows, 2 asset contracts, 2 fungible tokens, 2 NFT collections | 3,001,999 | 0.75% | 19 | 6 / 4 | 1,141,248 | 23,481 |
| 8 fungible tokens, the first condition fails (stops there) | 1,131,706 | 0.28% | 6 | 8 / 8 | 306,332 | 15,204 |

Added instructions per extra condition, from the 1- and 8-condition rows:

| Condition | Instructions per extra condition |
| --- | --- |
| `TimeWindow` | about 25,325 (no other contract is called) |
| `TokenBalance` over an asset contract | about 130,575 |
| `TokenBalance` over OpenZeppelin's fungible token | about 556,581 |
| `NftBalance` over OpenZeppelin's NFT collection | about 532,731 |

What the rows say:

- **A call to another contract is what costs instructions.** A `TimeWindow` adds about 25,325; a call to a real token or
  collection adds about 556,581, roughly 22 times as much, and it grows with every condition.
- **Sharing code barely helps.** Eight fungible tokens that share one code took 4,839,580 instructions; eight with
  eight different codes took 4,979,218 (a difference of 2.80%). Eight conditions naming the *same*
  token still took 4,335,280: each condition is its own call.
- **Evaluation stops at the first failure.** With the first of eight conditions failing, 1,131,706 instructions
  were used, against 4,979,218 when all eight were read.
- **A real token costs more than the earlier test token**: 1,083,150 instructions for one condition, against 891,678
  recorded for the 1.4 KB test token (1.21 times). The earlier figures were a floor, as that note said, and this is by how much.

## Fresh and settled

The fee column is where fresh and settled differ. One condition over OpenZeppelin's fungible token has a minimum fee of
306,265 stroops (0.0306 XLM) fresh and 15,148 settled. Over an asset contract it is
16,184 and 16,184. This is not Sorogate's overhead, and the instruction counts do not change. A direct call, with
no policy involved, shows the same thing:

| Call, made directly | Fee, fresh (stroops) | Fee, settled (stroops) |
| --- | --- | --- |
| OpenZeppelin fungible token, `balance` of a holder | 304,633 | 13,506 |
| OpenZeppelin fungible token, `balance` of an account with no entry | 13,485 | 13,485 |
| OpenZeppelin NFT collection, `balance` of a holder | 281,184 | 13,424 |
| Asset contract, `balance` of a holder | 14,543 | 14,543 |

What follows from this, and what does not:

- The extra fresh fee appears for a holder, whose balance entry exists, and **not** for an account with no entry (which costs
  13,485 either way). It goes away once one transaction has been applied. The reading that fits is that these
  contracts **extend the lifetime of the balance entry they read**, and the rent for that extension is part of the
  transaction's minimum fee. **That mechanism was inferred from these measurements, not read from the contracts' code, and it was
  not tested on other tokens.**
- It would happen when an entry's remaining lifetime is below the contract's own threshold. An entry just created is, and
  one that is read regularly mostly is not. So **fresh is the cost of the first read after a holder's entry runs low, and
  settled is the cost in between.** How often the first kind occurs depends on the token and on how often each holder is
  read, and is not measured here.
- Whoever pays for a transaction pays that rent, whichever contract asked for it. Sorogate asks for nothing; a policy over
  a token that extends its lifetime when read will include that token's rent in the fee of any transaction that evaluates it.
- Per extra heavy-token condition the settled fee grows by about 1,260 stroops.

## Footprint and write size

- **Footprint.** The worst policy measured, eight fungible tokens with different codes, reads 27 entries (6.75% of the 400
  allowed). Each added condition over a real token adds three entries: its balance, its instance and its code (or two, when
  the code is shared).
- **Disk reads.** The disk-read counters read 0 for every case except the asset contracts, which read their trustline (116
  bytes each). The contracts' entries were not counted as disk reads in these simulations.
- **Memory.** The simulation response did not report memory use, so it is not in the tables.

## `create` and a consumer's `claim`

| Call | Instructions | Fee (stroops) | Write bytes | Entries read-only / written |
| --- | --- | --- | --- | --- |
| create, 1 fungible token condition | 717,438 | 2,919,992 | 528 | 2 / 2 |
| create, 3 fungible token conditions | 889,932 | 4,934,408 | 792 | 4 / 2 |
| create, 8 fungible token conditions | 1,331,814 | 9,970,462 | 1,452 | 9 / 2 |
| claim, policy of 1 fungible token condition, fresh | 1,868,179 | 3,948,293 | 476 | 9 / 3 |
| claim, policy of 8 fungible token conditions, fresh | 5,830,304 | 5,995,043 | 476 | 30 / 3 |
| claim, policy of 1 fungible token condition, settled | 1,866,593 | 3,657,190 | 476 | 9 / 3 |
| claim, policy of 8 fungible token conditions, settled | 5,810,402 | 3,666,048 | 476 | 30 / 3 |

`create` writes a new entry that has to be kept alive, and its fee grows with the number of conditions, by about
1,007,210 stroops for each added condition here. A `claim` is the reference consumer's whole call: authentication, `evaluate`,
recording the claim, and paying a reward in an asset contract; it writes a claim record and moves a reward as well as reading
the policy. The split of these fees into their parts was not recorded, so this page does not say how much is rent, and a
`claim`'s fee is not a measure of `evaluate`'s.

## Is the limit of 8 conditions sensible?

`MAX_CONDITIONS` is 8. Against these measurements:

- **Instructions.** The heaviest policy measured used 4,979,218 of 400,000,000 (1.24%), about 80 times
  under the limit. A mixed policy of eight used 0.75%.
- **Footprint.** 27 of 400 entries (6.75%); at that rate of three entries a condition, roughly 133 conditions would fit.
- **Write size.** A policy of eight conditions wrote 1,452 bytes against 132,096 allowed.

**Reading of the numbers:** of the limits measured here (instructions, footprint entries and write size), none is close to
binding at 8 for the contracts measured. Memory use was not reported, so that limit is not covered. The cap is far below
what the network would permit for these contracts, so it is a choice and not a necessity. The data gives no reason to raise it, and a
higher limit was not asked for, so **the cap is unchanged**.

What these measurements do not support:

- They say nothing about a **token that burns its whole budget**. A call that exhausts the budget aborts the
  evaluation however many conditions the policy has (see the [threat model](THREAT_MODEL.md)), so one such token is
  enough, and a cap cannot prevent that. The cap limits how many tokens a single policy exposes its holders to, not whether
  one bad token is fatal.
- They use two well-behaved OpenZeppelin contracts and asset contracts. A token that does real work in `balance` (an
  oracle, a vesting schedule, a large lookup) would cost more per condition, and the margin to the instruction limit would
  be smaller.
- The fee a person pays depends on the fresh-or-settled state described above, which varies from call to call.

## Limitations

- **One network, one day, one RPC server.** Stellar Testnet (protocol 29), on 2026-10-07. Fees and limits can change with the network's
  configuration.
- **Simulations.** Nothing here is a transaction that was applied and billed. The simulation is the network's own estimate.
- **Contracts we deployed.** Two OpenZeppelin examples built from `stellar-contracts` v0.7.2 (OpenZeppelin/stellar-contracts v0.7.2 (commit a9c42169000638da937577f592ebf61a7a3c94ca): examples/fungible-pausable and examples/nft-sequential-minting, built with stellar-cli 27.1.0, rustc 1.99.0, soroban-sdk 26.1.0).
  Other tokens will differ.
- **Eight different codes by construction.** The differing copies are the same program with an empty section appended
  (see above). Eight genuinely unrelated tokens could differ more.
- **Not exact between runs.** A second run on freshly deployed contracts ([note](evidence/testnet-costs-rerun-2026-10-08.md)) gave the same figures for the time-window cases and instruction counts up to 0.29% different for the rest, in both directions, and fees up to 2.2% different. Read an instruction count as good to about a third of a percent, not to the instruction.
- **Memory and the split of the fee** into its parts were not reported or recorded.
- The refund of unused rent after a real transaction was not measured.

## Reproduce

```bash
stellar contract build
# build OpenZeppelin's examples from https://github.com/OpenZeppelin/stellar-contracts at tag v0.7.2:
#   stellar contract build --package fungible-pausable-example
#   stellar contract build --package nft-sequential-minting-example
npm ci
npm run testnet:costs -w @sorogate/sdk -- --wasm-dir ../../target/wasm32v1-none/release \
  --ft-wasm <fungible_pausable_example.wasm> --nft-wasm <nft_sequential_minting_example.wasm> \
  --sources "<where the two WASM files came from>" --report costs.json
```

It deploys about forty contracts on Testnet with throwaway keys and takes several minutes.
