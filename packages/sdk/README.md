# @sorogate/sdk

TypeScript for working with Sorogate access policies. Not published yet.

It has two halves, and the contract is the authority:

- **A model of the rules** (`validateConditions`, `evaluate`, `decodeTokenBalance`, `decodeNftBalance`). Pure
  functions with no network. They follow [`spec/SPEC.md`](../../spec/SPEC.md) and are tested against the same
  [vectors](../../spec/vectors) as the contract.
- **A read-only client** (`evaluateOnChain`, `getPolicy`, `readBalance`, `fetchSnapshot`). It simulates calls through
  a Soroban RPC server. Nothing is signed or submitted.

## Ask the contract

```ts
import { rpc } from '@stellar/stellar-sdk';
import { evaluateOnChain } from '@sorogate/sdk';

const context = {
  rpc: new rpc.Server('https://soroban-testnet.stellar.org'),
  networkPassphrase: 'Test SDF Network ; September 2015',
  source: 'G...', // any account that exists; it only sources the simulated transaction
};

const { decision, ledgerSequence } = await evaluateOnChain(context, {
  contractId: 'C...', // the access-policy contract
  policyId: 1n,
  subject: 'G...', // the address to check
});
// decision = { allowed, version, failedIndex, reason }
```

`evaluateOnChain` is the answer that counts. It does **not** prove the caller controls `subject`; see the
specification, section 8.

## Work it out locally

```ts
import { evaluate, fetchSnapshot, getPolicy } from '@sorogate/sdk';

const { policy } = await getPolicy(context, { contractId, policyId: 1n });
const { snapshot } = await fetchSnapshot(context, { conditions: policy.conditions, subject });
const decision = evaluate(policy, snapshot);
```

`fetchSnapshot` reads the ledger time and every balance from **one ledger** (it reads again if the network moves
on), because a balance and a time from different ledgers describe no moment that existed. Use this path to preview
a policy or explain a denial; use `evaluateOnChain` when the answer matters.

Two things to know:

- A simulation runs against the latest closed ledger, and the transaction it predicts is applied in a later one.
  Near the edge of a time window, the two can differ.
- A token that exhausts its whole budget makes the contract abort without a decision. `readBalance` reports such
  a token as `unavailable`.

## Amounts

A policy's `min` is in a token's **base units**: with 7 decimals, one whole token is 10,000,000. Typing a display amount
where base units are expected gives a minimum that is wrong by a factor of ten to the number of decimals. Convert with
these, which use exact text and never floating point:

```ts
import { fromBaseUnits, readDecimals, toBaseUnits } from '@sorogate/sdk';

const decimals = await readDecimals(context, tokenAddress); // calls the token's decimals()
const min = toBaseUnits('12.5', decimals);                  // 125000000n for 7 decimals
fromBaseUnits(min, decimals);                               // '12.5'
```

`toBaseUnits` refuses an amount with more decimal places than the token has, instead of rounding it, and refuses
anything that is not plain digits with an optional decimal part.

## Showing a decision to a person

```ts
import { explainDecision } from '@sorogate/sdk';

explainDecision(decision, policy.conditions, { decimals: { [tokenAddress]: 7 } });
// "Denied: condition 2 of 2 is not met: holds at least 150 of token CBUXA…GEFX. The balance is lower (policy version 1)."
```

`describeCondition` describes one condition. Neither decides anything; they only describe what the contract or the model
decided.

## Compare with the contract on Testnet (manual)

`scripts/testnet-differential.ts` deploys the contract and the test-token fixtures to Testnet with throwaway keys, creates
random policies, and checks that `evaluateOnChain` and the model agree for every one. It takes a few minutes, talks to a
public network, and is not part of CI. The result of one run is in
[`docs/evidence`](../../docs/evidence/testnet-differential-2026-10-07.md).

```bash
stellar contract build
npm run testnet:differential -w @sorogate/sdk -- --wasm-dir <the folder with access_policy.wasm and mock_token.wasm> --policies 30 --seed 1
```

The same plumbing runs the reference consumer end to end (`npm run testnet:gated-claim -w @sorogate/sdk -- --wasm-dir <the folder
with the three WASM files>`): a claim, a refused double claim, the owner changing the rule, and a pinned consumer refusing it.
One run is recorded in [`docs/evidence`](../../docs/evidence/testnet-gated-claim-2026-10-07.md).

## Errors

| Error | Meaning |
| --- | --- |
| `ContractCallError` | The contract returned one of its own errors; `errorName` is for example `PolicyNotFound`. |
| `SimulationError` | The simulation failed for any other reason. |
| `LedgerMovedError` | `fetchSnapshot` could not get a consistent read in the allowed number of attempts. |
| `DecodeError` | The contract returned something this package does not recognise. |

## Develop

```bash
npm ci
npm test            # unit tests, the shared vectors, and the codec against recorded contract output
npm run lint && npm run typecheck && npm run build
```

`test/fixtures/testnet-recordings.json` holds real return values of the deployed contract, recorded from Testnet,
with their provenance. They are why the codec is tested against the contract's own bytes and not only against
shapes written by hand.
