# SantanderAI open-source integration map

[Banco Santander AI Lab](https://github.com/SantanderAI) publishes Apache-2.0 tooling for responsible AI in financial services. None are banking products — they strengthen Goemon **fraud graph ML** and **agent governance**.

## Adopted in this repo

| Upstream repo | Goemon integration | Path |
|---|---|---|
| [gen-fraud-graph](https://github.com/SantanderAI/gen-fraud-graph) | TypeScript synthetic graph generator for fraud-engine eval + future Identity Vault training | `fraud-engine/src/eval/syntheticFraudGraph.ts` |
| [mech-gov-framework](https://github.com/SantanderAI/mech-gov-framework) | R1/R2/R3 governance overlay on Phase 15 gate decisions | `backend/src/integrations/mechGovService.ts` |

### mech-gov regimes

- **R1** — advisory (metrics only)
- **R2** — confidence hard gate → escalate
- **R3** — compliance/KYC skills always human-gated (`kyc-review`, `sanctions-rescreen`, `compliance-filing`)

Enable: `MECH_GOV_ENABLED=true` (default on).

### gen-fraud-graph usage

```bash
cd fraud-engine && npm test   # includes synthetic-fraud-graph.test.ts
```

Optional upstream Python generator for larger benchmarks:

```bash
pip install git+https://github.com/SantanderAI/gen-fraud-graph
```

## Recommended next (P2)

| Repo | Use |
|---|---|
| [autoguardrails](https://github.com/SantanderAI/autoguardrails) | Tune SmartChat/support `policy.md` before real-time customer agent |
| [sota-stressed-datasets](https://github.com/SantanderAI/sota-stressed-datasets) | Stressed credit/fraud fixtures for NL intent + rules eval |

## Low priority (engineering only)

| Repo | Use |
|---|---|
| [ralph](https://github.com/SantanderAI/ralph) | AI coding loop — dev velocity, not product |
| [genetic-algorithm](https://github.com/SantanderAI/genetic-algorithm) | Pairs with autoguardrails for policy search |

## License

- Code repos: Apache-2.0 — compatible with Goemon prototype
- `sota-stressed-datasets` data: CC BY 4.0 — attribute if redistributed
