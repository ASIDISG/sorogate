# Documentation

Status: **early, Testnet only, not audited.** See [`../README.md`](../README.md). The words used for what stands behind a claim are
defined in [`EVIDENCE.md`](EVIDENCE.md).

## Where to find each thing

| If you want to know | Read |
| --- | --- |
| **What this is, in a few minutes** | [`../README.md`](../README.md), then [`ARCHITECTURE.md`](ARCHITECTURE.md) (`#the-pieces`, `#one-evaluation`) |
| **The policy model**: what a policy is and what it stores | [`../spec/SPEC.md`](../spec/SPEC.md#1-what-a-policy-is), [`#2-data-model`](../spec/SPEC.md#2-data-model) |
| **What each condition means** | [`../spec/SPEC.md`](../spec/SPEC.md#41-conditions) and [`#42-time`](../spec/SPEC.md#42-time) |
| **How a decision is worked out** | [`../spec/SPEC.md`](../spec/SPEC.md#4-evaluation), and [`ARCHITECTURE.md`](ARCHITECTURE.md#one-evaluation) |
| **What counts as a balance read** | [`../spec/SPEC.md`](../spec/SPEC.md#43-what-a-balance-read-covers) |
| **Using the TypeScript SDK** | [`../packages/sdk/README.md`](../packages/sdk/README.md) |
| **Using a policy from your own contract** | [`INTEGRATING.md`](INTEGRATING.md#the-pattern), [`#what-goes-wrong`](INTEGRATING.md#what-goes-wrong), and a separate working example, [`Sorogate/example-consumer`](https://github.com/Sorogate/example-consumer) |
| **Authentication versus authorization**: `evaluate` does not prove who is asking | [`INTEGRATING.md`](INTEGRATING.md#the-pattern) (step 1), [`../spec/SPEC.md`](../spec/SPEC.md#8-what-this-does-not-do), [`THREAT_MODEL.md`](THREAT_MODEL.md#what-is-not-protected), and the recorded run in [`evidence/testnet-gated-claim-2026-10-07.md`](evidence/testnet-gated-claim-2026-10-07.md) |
| **The public deployment**: address, code hash, date, who controls it | [`DEPLOYMENT.md`](DEPLOYMENT.md), [`deployments/testnet.json`](deployments/testnet.json) |
| **The Testnet limitation** | [`../README.md`](../README.md) (the status line), [`DEPLOYMENT.md`](DEPLOYMENT.md#what-that-means), [`THREAT_MODEL.md`](THREAT_MODEL.md#what-is-not-protected) |
| **What it costs**: instructions, fees, footprint, and the limit of 8 conditions | [`COSTS.md`](COSTS.md) |
| **Security assumptions and what could go wrong** | [`THREAT_MODEL.md`](THREAT_MODEL.md#what-is-protected), [`#who-is-involved`](THREAT_MODEL.md#who-is-involved), [`#threats`](THREAT_MODEL.md#threats), [`#supply-chain-and-operation`](THREAT_MODEL.md#supply-chain-and-operation) |
| **Upgrade and administrator authority**: there is none | [`../spec/SPEC.md`](../spec/SPEC.md#6-lifecycle-and-ownership), [`DEPLOYMENT.md`](DEPLOYMENT.md) (the "Admin / owner" row), [`ARCHITECTURE.md`](ARCHITECTURE.md#decisions-worth-knowing) |
| **What happens when something fails** | [`../spec/SPEC.md`](../spec/SPEC.md#43-what-a-balance-read-covers) (a failed read is a denial), [`INTEGRATING.md`](INTEGRATING.md#what-goes-wrong), [`THREAT_MODEL.md`](THREAT_MODEL.md#threats) |
| **Lifetimes and archival** | [`../spec/SPEC.md`](../spec/SPEC.md#7-lifetime), [`DEPLOYMENT.md`](DEPLOYMENT.md#keeping-it-alive), and the measurement in [`evidence/testnet-ttl-2026-10-07.md`](evidence/testnet-ttl-2026-10-07.md) |
| **What has and has not been checked** | [`THREAT_MODEL.md`](THREAT_MODEL.md#what-has-and-has-not-been-checked), and each note in [`evidence/`](evidence), which ends with what it does not show |
| **Credentials**, and why they are not a condition | [`CREDENTIALS.md`](CREDENTIALS.md) |
| **What is not built** | [`../spec/SPEC.md`](../spec/SPEC.md#9-not-in-this-version), [`ARCHITECTURE.md`](ARCHITECTURE.md#not-in-this-version) |
| **Contributing, and open work** | [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../ISSUES_BACKLOG.md`](../ISSUES_BACKLOG.md) |
