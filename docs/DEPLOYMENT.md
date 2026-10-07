# Public Testnet deployment

**This is a public development deployment on Stellar Testnet. It is not a production deployment.** Testnet is
reset from time to time and its tokens have no value, the contract has not been audited, and nothing here should be
used with real value. The machine-readable record is [`deployments/testnet.json`](deployments/testnet.json).

Label: **Live** means the fact was read from the network on the date shown. It was true then; run
[`verify`](#check-that-it-is-this-code) to see whether it still is.

| | |
| --- | --- |
| Network | Stellar Testnet (`Test SDF Network ; September 2015`), protocol 29 |
| Contract address | `CACR5H46E7VKEDJUWRLKZPJPQVPRHTRTJHZOMQLEIHMTXN4MW7O47YQW` ([explorer](https://stellar.expert/explorer/testnet/contract/CACR5H46E7VKEDJUWRLKZPJPQVPRHTRTJHZOMQLEIHMTXN4MW7O47YQW)) |
| Contract | `contracts/access-policy`, workspace version `0.0.0` (pre-release; the contract has no on-chain version function, so the WASM hash below is its identity) |
| WASM hash | `f702e9d267262ab3f9548fa62021b4c31bb5b5f4f3652ff713906dcd48906814`, 11,457 bytes. The code was fetched back from the network after deployment and compared with the local build byte for byte |
| Built from | commit `1e94264549a220a80d97347386042810f48e47ba`, `stellar contract build` with stellar-cli 27.1.0, rustc 1.96.0, soroban-sdk 28.0.0 |
| Deployment transactions | upload `e75b58c3bc2cb569c15dcd0a0acde7b1a22c40e9a38b9f1a377659fd17147c85`; create `ce7ca6247655cb0457cd44aa3c6b9a308a0793bd368a3929a070fd87d3971fba` (ledger 5,071,126) |
| Deployment date | 2026-10-07, 13:20:17 UTC (close time of the creation transaction) |
| Deployed by | `GBZEURYLVXFGQ5HOF6UFAP64SXN3Y74GPCONROASPJNSWQFH5PCZ6GAY`, a throwaway account whose secret key was never printed or saved |
| Admin / owner | **None.** The contract has no administrator, no owner and no upgrade path ([`SPEC.md`](../spec/SPEC.md) section 6). The deployer has no power over it, so discarding its key costs nothing |
| Specification | [`spec/SPEC.md`](../spec/SPEC.md), draft 0.1, as at the commit above |
| Policy versions | A policy starts at version 1 and its version goes up by one on every `update`. A deactivation does not change it |

## What that means

- **Policies on this contract belong to whoever created them.** The contract itself has no authority over any policy.
  Anyone can create a policy here, and only its owner can change or deactivate it.
- **Policies made for this repository's own evidence and examples are owned by discarded keys.** They can never be
  changed or deactivated. That is deliberate: it makes them stable examples, and it also means they must not be used for
  anything real.
- **A bug cannot be fixed in place.** A fixed contract is a new deployment with new policy ids that consumers have to
  move to. This deployment would stay as it is.
- **Testnet resets.** When Testnet is reset, this contract and everything on it disappears. This file would then be
  out of date until the contract is deployed again and the record rewritten.

## Check that it is this code

Anyone can check that the code on the network is the code in this repository. It needs no key and sends nothing:

```bash
stellar contract build
npm ci
npm run testnet:deployment -w @sorogate/sdk -- verify \
  --contract CACR5H46E7VKEDJUWRLKZPJPQVPRHTRTJHZOMQLEIHMTXN4MW7O47YQW \
  --wasm ../../target/wasm32v1-none/release/access_policy.wasm
```

It prints the size and hash of the code the network holds and of your build, and says `IDENTICAL` or `DIFFERENT`.

What this does and does not show:

- The build was **reproducible** in the one case it was tried: rebuilding at the deployment commit on the same machine
  with the same tools, on a different day, gave the same hash as every earlier recorded run (`f702e9d2…`).
- It was **not** compared across machines or tool versions. CI builds with stellar-cli 28.1.0; the deployment used 27.1.0.
  Whether the two give identical bytes has not been checked, so a different hash from a different toolchain does not by
  itself mean the code differs.

## Keeping it alive

A contract has two ledger entries that expire if nobody extends them: its **instance** and its **code**. When one
expires it is archived, not erased, and has to be restored before the contract can be used again.

- At deployment both were extended to the network's practical maximum: ledger 8,071,127, about 173 days later
  (estimated 2027-03-30, at five seconds a ledger). Live, 2026-10-07.
- Anyone can extend them again, for any contract, with a funded account. This command uses a throwaway one:

  ```bash
  npm run testnet:deployment -w @sorogate/sdk -- extend --contract CACR5H46E7VKEDJUWRLKZPJPQVPRHTRTJHZOMQLEIHMTXN4MW7O47YQW
  ```

  It was run once, about a minute after deployment, and moved the end from ledger 8,071,127 to 8,071,148 (Live, 2026-10-07). That
  shows the command works. It does not show what happens to a contract that is close to expiry or already archived.
- The policy contract's own `bump(id)` extends a **policy** and the contract **instance**. Whether it also extends the
  **code** has not been measured.

The network refused an extension of 3,110,400 ledgers and accepted 3,000,000, so its limit lies between the two.

## Not this one

An earlier attempt the same day, `CAVNAUBPPSRCWVALWJIR6WMBL7ZTMAJXJLLXNTKSZBRIVAAZEZC3LFKQ`, deployed the same code but
stopped on a bug in the deployment script before its transactions could be recorded. It is unused and can be ignored.
