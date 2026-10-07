# Test vectors

These files hold the **expected answers** of an access policy. Every implementation is run against the same
files: the TypeScript model in `packages/sdk` (`test/vectors.test.ts`) and the Soroban contract in
`contracts/access-policy` (`tests/vectors.rs`). If they disagree on a case, one of them has a bug, and `../SPEC.md` decides which.

**Changing a vector is changing the specification.** Do it in a pull request that also updates `SPEC.md` when the
meaning changes, and make sure every implementation still passes.

Numbers that can exceed 53 bits (`i128`, `u64`) are written as decimal strings. Small numbers (`u32`, versions,
indexes) are JSON numbers.

## Files

| File | What it pins down |
| --- | --- |
| `evaluate.json` | The `Decision` for a stored policy, a subject and the state of the world |
| `validate.json` | Which lists of conditions are accepted when a policy is created or updated, and the error otherwise |

Both start with `{ "schema": 1, "description": ..., "tokens": {...}, "cases": [...] }`.

## `tokens`

Named contracts that conditions refer to. A name stands for an address; harnesses invent the real one.

| `kind` | Behaviour of `balance(subject)` |
| --- | --- |
| `i128` | Returns an `i128`. `balances` maps subject name to amount; a subject not listed has 0. |
| `u32` | Returns a `u32` (the SEP-50 shape OpenZeppelin implements). `balances` as above. |
| `u64` | Returns a `u64`: a legal reading of "unsigned integer" that is **not** `u32`. |
| `panics` | The call raises an error. |
| `no_balance_function` | A deployed contract that has no `balance` function. |
| `account` | Not a contract: a classic account address. Validation vectors only. |
| `missing` | A contract address with nothing deployed. Validation vectors only. |

## `evaluate.json` cases

```json
{
  "name": "...",
  "timestamp": "100",            // ledger time in unix seconds; default "0"
  "policy": {
    "active": true,              // default true
    "extraUpdates": 2,           // default 0; the policy was updated this many times, so version = 1 + this
    "conditions": [ ... ]
  },
  "subject": "alice",            // a name; balances are looked up under it
  "expect": { "allowed": true, "version": 3, "failedIndex": null, "reason": "None" }
}
```

`reason` is a `DenyReason` name from `SPEC.md` section 5. `failedIndex` is `null` when allowed and when the
reason is `Inactive`.

## `validate.json` cases

```json
{ "name": "...", "conditions": [ ... ], "expect": { "ok": true } }
{ "name": "...", "conditions": [ ... ], "expect": { "ok": false, "error": "InvalidMinimum" } }
```

`error` is a contract error name from `SPEC.md` section 3. The vectors include cases that pin the order in which
rules are checked.

## Conditions

```json
{ "type": "token_balance", "token": "gold", "min": "100" }
{ "type": "nft_balance", "collection": "badge", "min": 1 }
{ "type": "time_window", "notBefore": "100", "notAfter": null }
```

## Random differential testing

The committed vectors are written by hand. To look for cases nobody thought of, `packages/sdk/scripts` can generate
random vector files in the same format, with the expected answer taken from the TypeScript model. The generator aims
balances at `min`, `min - 1` and `min + 1`, and window edges at the evaluation time, because that is where bugs live.
The same seed always gives the same files.

```bash
# npm runs a workspace script from packages/sdk, so --out is relative to that folder
npm run generate:random -w @sorogate/sdk -- --seed 42 --count 1000 --out ../../spec/vectors/generated
# the Rust test runs from contracts/access-policy, so give it an absolute path
SOROGATE_RANDOM_VECTORS="$PWD/spec/vectors/generated" cargo test -p access-policy --test vectors random
```

`spec/vectors/generated/` is not committed. Without `SOROGATE_RANDOM_VECTORS` the random tests are skipped. CI runs
four seeds of 1,000 cases for each file on every push. If one fails, the log shows the seed and the cases that
disagree; reproduce it with the command above and decide whether the contract, the TypeScript model, or the
specification is wrong.
