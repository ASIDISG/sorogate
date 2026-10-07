# How to read the evidence

Every claim in this repository's documents should say what stands behind it. These are the words used, and what each one does
and does not mean. The words are checked: a test reads the documents and fails if one is used that is not defined here.

| Label | What it means | What it does not mean |
| --- | --- | --- |
| **Unit-tested** | A test in this repository that CI runs on every push: the contract's unit tests, the shared test vectors run against both the contract and the TypeScript model, the random comparison of the two, the SDK and site tests. It runs in a simulated environment (the Soroban SDK's test environment, or Node), not on a network | That it was seen working on Stellar. A test shows the code does what the test checks, no more |
| **Recorded** | A run of a script or command whose raw output is kept in [`evidence/`](evidence) (or in [`COSTS.md`](COSTS.md)), as of the date it names. It can be repeated by running the same script. CI does not run it, because it uses a public network | That it still holds. A recorded run happened once. Each recorded note ends with what it does *not* show |
| **Live** | A fact read from the network on the date shown that anyone can re-check with a command, such as the public deployment's address and code hash ([`DEPLOYMENT.md`](DEPLOYMENT.md), `verify`) | That it is still true. Testnet is reset from time to time, and a live fact then goes stale until the record is rewritten |
| **Simulated** | The network was asked what a call would do, and nothing was applied: a refusal that cannot be sent, every cost figure in [`COSTS.md`](COSTS.md), a read-only call. The same code runs, but nothing happens on the ledger, and the numbers are the network's estimate | That the call was made, or billed |
| **Example** | Written to explain, not to prove: a snippet in a README, the playground's examples, the example repository as a model to copy. (The playground's examples are also the shared vectors, which are Unit-tested against both implementations; as examples they only illustrate.) | Evidence of anything |
| **Documented** | Stated in Stellar's own documentation, and not checked here | That it was seen working here |
| **Reasoning** | Follows from the design, and no test or run checks it | That it is wrong, only that nothing here shows it is right |

**Future work** is not a label but a place: [`../README.md`](../README.md) under "What is planned", the "Not in this version" section of
[`../spec/SPEC.md`](../spec/SPEC.md), and [`../ISSUES_BACKLOG.md`](../ISSUES_BACKLOG.md). Nothing listed there is a claim about what exists.

## Inside a recorded note

A recorded note names what kind of result each step is:

- **Transaction**: sent to the network and applied. A transaction can be applied and *fail*, and that is a real refusal with a real error
  code. A claim that fails this way did not merely look wrong in a simulation.
- **Simulation** (the label **Simulated**, above): asked of the network without applying anything.
- **Reading**: a value read from the network.

## The rules this follows

1. A claim says what stands behind it, using these words.
2. A recorded note says what it does *not* show, and a run is not described as showing more than it did.
3. When a run found a mistake in its own script, the note says so rather than quietly using the corrected run.
4. The status of the project is never dropped: Testnet only, not audited, a development deployment and not production. Nothing here
   claims audit, security, mainnet readiness, or use by anyone else without evidence.
5. The documents are checked by a test (`packages/site/test/docs.test.ts`): that the words above are the only ones used, that every
   relative link and heading link resolves, and that the numbers the README states about tests and vectors match the files.
