# Costs measured a second time, on freshly deployed contracts, 2026-10-08

**Label: Recorded.** A second run of `packages/sdk/scripts/testnet-costs.ts`, made from a clean clone of the repository, against new deployments of every contract. Raw data: [`testnet-costs-rerun-2026-10-08.json`](testnet-costs-rerun-2026-10-08.json). First run: [`testnet-costs-2026-10-07.json`](testnet-costs-2026-10-07.json). It is not part of CI, because it uses a public network. Every figure is **Simulated**, as in [COSTS.md](../COSTS.md).

The question was whether the numbers in [COSTS.md](../COSTS.md) can be reproduced by someone else.

## Result

- The same 21 cases, fresh and settled, give 42 instruction figures. 8 were identical to the first run and 34 were not. The largest difference was 0.29%.
- Every case that names no other contract (the time-window cases) was identical to the instruction.
- Cases that read other contracts (asset contracts, tokens, collections) differed by a small amount, in both directions. The cause was not established. The two runs differ in every contract address and account, and in the ledger they ran at; a direct call of the token's own `balance` cost the same number of instructions in both.
- Within one run the figures did not move across repeats (as COSTS.md says); between runs on new deployments they can.
- The minimum resource fee differed by up to 2.2% between runs. It includes rent and network-state charges, and the two runs simulated at different ledgers; the parts were not separated, so the cause is not established.
- The network limits that were read were the same in both runs.
- The conclusions in COSTS.md (the cost of an extra condition, the limit of 8) do not change at this size of difference.

So: treat any instruction count as accurate to about a third of one percent, not to the instruction, and a fee as accurate to a few percent.

## Settled cases, side by side

| Case | Instructions, first run | Instructions, second run | Difference | Fee, first run (stroops) | Fee, second run (stroops) |
| --- | --- | --- | --- | --- | --- |
| 1 time window | 583,197 | 583,197 | +0 (+0.00%) | 13,927 | 13,927 |
| 2 time windows | 608,523 | 608,523 | +0 (+0.00%) | 13,944 | 13,944 |
| 3 time windows | 633,847 | 633,847 | +0 (+0.00%) | 13,962 | 13,962 |
| 8 time windows | 760,475 | 760,475 | +0 (+0.00%) | 14,051 | 14,051 |
| 1 asset contract (TokenBalance) | 679,383 | 680,983 | +1,600 (+0.24%) | 16,184 | 16,185 |
| 2 asset contracts (TokenBalance) | 803,578 | 805,878 | +2,300 (+0.29%) | 18,460 | 18,462 |
| 3 asset contracts (TokenBalance) | 930,135 | 931,535 | +1,400 (+0.15%) | 20,737 | 20,738 |
| 8 asset contracts (TokenBalance) | 1,593,408 | 1,595,904 | +2,496 (+0.16%) | 32,148 | 32,150 |
| 1 fungible token, each its own code (TokenBalance) | 1,081,756 | 1,082,456 | +700 (+0.06%) | 15,148 | 15,148 |
| 2 fungible tokens, each its own code (TokenBalance) | 1,619,330 | 1,623,022 | +3,692 (+0.23%) | 16,396 | 16,399 |
| 3 fungible tokens, each its own code (TokenBalance) | 2,168,055 | 2,171,747 | +3,692 (+0.17%) | 17,652 | 17,655 |
| 8 fungible tokens, each its own code (TokenBalance) | 4,960,941 | 4,961,825 | +884 (+0.02%) | 23,968 | 23,969 |
| 1 NFT collection, each its own code (NftBalance) | 1,058,402 | 1,059,102 | +700 (+0.07%) | 15,131 | 15,132 |
| 2 NFT collections, each its own code (NftBalance) | 1,570,753 | 1,572,781 | +2,028 (+0.13%) | 16,362 | 16,363 |
| 3 NFT collections, each its own code (NftBalance) | 2,097,791 | 2,097,219 | -572 (-0.03%) | 17,603 | 17,603 |
| 8 NFT collections, each its own code (NftBalance) | 4,770,535 | 4,771,575 | +1,040 (+0.02%) | 23,835 | 23,836 |
| 8 fungible tokens that share one code (TokenBalance) | 4,823,707 | 4,833,847 | +10,140 (+0.21%) | 22,773 | 22,780 |
| 8 conditions naming the same fungible token | 4,333,830 | 4,336,378 | +2,548 (+0.06%) | 17,424 | 17,426 |
| 3 mixed: window, asset contract, NFT collection | 1,205,334 | 1,207,984 | +2,650 (+0.22%) | 17,424 | 17,426 |
| 8 mixed: 2 windows, 2 asset contracts, 2 fungible tokens, 2 NFT collections | 2,993,897 | 3,000,917 | +7,020 (+0.23%) | 23,481 | 23,486 |
| 8 fungible tokens, the first condition fails (stops there) | 1,130,312 | 1,131,012 | +700 (+0.06%) | 15,204 | 15,204 |

## To repeat it

As in [COSTS.md](../COSTS.md#reproduce). The second run used the OpenZeppelin tokens built from the same commit as the first.
