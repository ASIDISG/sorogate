# What keeps the contract's entries alive, on Testnet, 2026-10-07

**Label: Recorded.** One run of `packages/sdk/scripts/testnet-ttl.ts`. Raw data, with every ledger number:
[`testnet-ttl-2026-10-07.json`](testnet-ttl-2026-10-07.json). It is not part of CI, because it uses a public network.

A contract has three ledger entries that expire if nobody extends them, and an expired entry is archived: its **instance**, its
**code** (the WASM) and each **policy**. This run measures what moves the lifetime of each. "Until" is the last ledger an entry
is live in; the days are at five seconds a ledger (17,280 ledgers a day).

## Result

| Step | Ledger read at | Instance until | Code until | Policy until |
| --- | --- | --- | --- | --- |
| just deployed | 5,077,599 | 5,198,558 (7 d) | 5,198,557 (7 d) | - |
| after create (a write by the owner) | 5,077,600 | 6,632,800 (90 d) | 6,632,800 (90 d) | 6,632,800 (90 d) |
| thirty seconds later, nothing has touched it | 5,077,606 | 6,632,800 (90 d) | 6,632,800 (90 d) | 6,632,800 (90 d) |
| after bump, called by a different account | 5,077,607 | 6,632,807 (90 d) | 6,632,807 (90 d) | 6,632,807 (90 d) |
| after evaluate sent as a real transaction | 5,077,614 | 6,632,807 (90 d) | 6,632,807 (90 d) | 6,632,807 (90 d) |

- **A fresh contract's instance and code live about 7 days** (120,959 and 120,958 ledgers), the network's minimum
  for a persistent entry.
- **A write extends all three to 90 days.** `create` took the instance, the code and the new policy to exactly 90 days from that
  ledger (1,555,200 ledgers).
- **Nothing moves them by itself.** Thirty seconds later (six ledgers) the lifetimes had not changed.
- **`bump` extends all three, and anyone can call it.** It was called by a different account from the owner, and moved the
  instance, the code and the policy to exactly 90 days from that ledger. So the contract's own `bump(id)` also keeps the
  **code** alive, which `docs/DEPLOYMENT.md` had listed as unmeasured. It needs a policy id that exists.
- **A read extends nothing.** A real `evaluate` transaction left every lifetime unchanged.

## A first run that was wrong, and why it is not the evidence

The first run deployed the unmodified build, and showed the code with 173 days left from the moment of deployment. That was
not a default: code is stored once per hash and shared by every contract made from the same WASM, and this build's code had
already been extended to about 173 days for the public deployment ([`../DEPLOYMENT.md`](../DEPLOYMENT.md)). The run could not
have shown what a write or `bump` does to the code. This run deploys a copy of the same program with an empty custom section
appended (b7fca8db…2aabe6b against f702e9d2…8906814), so its code is its own. That section
is data the WebAssembly format sets aside for tools; it does not change what the contract does.

## How it was done

| | |
| --- | --- |
| Network | Stellar Testnet (protocol 29) |
| Run | 2026-10-07T22:20:58.466Z |
| Contract | `CDCA5WXZHKLCFXCEKXB72BSK3P4X4GSYRZQJWEQLDKTVNLCNYGCBUEX6`, a throwaway copy of the policy contract that this run deployed; policy id `1` (a time window with no effect on the measurement) |
| Keys | Two throwaway accounts, created in memory and funded by friendbot. The owner made the policy; a different account called `bump` and `evaluate` |

## What it does not show

- **Archival and restoration.** No entry was allowed to expire, so nothing here shows what happens to one that has, or what a
  restoration costs ([backlog](../../ISSUES_BACKLOG.md): the archived-policy path).
- **A write when the lifetime is already long.** The contract tops an entry up only when it has less than 30 days left;
  this run only wrote to entries with 7 days or none, so the no-op case was not observed.
- **Other contracts' entries.** A policy over a token reads the token's entries, and some tokens extend their own lifetimes when
  read ([`../COSTS.md`](../COSTS.md)). That is the token's behaviour and was not part of this run.
- One run, on one network, on one day. The numbers are the network's own; they can change with its configuration.
