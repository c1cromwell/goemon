# 07 — Technical Architecture

## System overview

Goemon Global Finance is a service-oriented Go backend, with Hedera as the settlement chain, Temporal for money-movement workflows, Conductor OSS for agent workflows, and Postgres as the system-of-record ledger. The mobile and web clients communicate via gRPC (with Connect for transport) and a thin REST gateway where needed.

```
┌─────────────────────────────────────────────────────────────┐
│             Clients (iOS, Android, Web, Admin)              │
└─────────────────┬───────────────────────────┬───────────────┘
                  │                           │
                  ▼                           ▼
        ┌──────────────────┐        ┌────────────────────┐
        │   API Gateway    │        │  Admin Console     │
        │ (gRPC + Connect) │        │  (Python/CLI)      │
        └────────┬─────────┘        └────────┬───────────┘
                 │                           │
   ┌─────────────┼─────────────────┐         │
   │             │                 │         │
   ▼             ▼                 ▼         ▼
┌──────┐  ┌─────────────┐  ┌──────────────┐  
│ Auth │  │   Wallet    │  │  Marketplace │  
│ Svc  │  │   Service   │  │   Service    │  
└──┬───┘  └──────┬──────┘  └──────┬───────┘  
   │            │                  │           
   ▼            ▼                  ▼           
┌──────────────────────────────────────────┐  
│              Temporal Cluster            │  
│   (money workflows, payments, KYC)       │  
└──────┬───────────────────────────────────┘  
       │                                       
       ▼                                       
┌──────────────────────────────────────────┐  
│             Conductor OSS                │  
│   (agent workflows, ops, support)        │  
└──────┬───────────────────────────────────┘  
       │                                       
       ▼                                       
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐
│ Postgres │ │  Redis   │ │  Kafka   │ │  ClickHouse   │
│ (ledger) │ │ (cache)  │ │ (events) │ │  (analytics)  │
└──────────┘ └──────────┘ └──────────┘ └────────────────┘
       │
       ▼
┌────────────────────────────────────────────────────────────┐
│   External: Hedera Network, Circle CCTP, Chainlink,        │
│   Partner Bank API, KYC/IDV vendors, Off-ramp partners     │
└────────────────────────────────────────────────────────────┘
```

## Backend services

Each service is a Go module deployed as one or more containers. Service-to-service communication is gRPC.

### Auth Service

Owns user identity, sessions, passkey credentials, recovery flows. Stateless except for the credential store.

**Tech:** Go 1.22+, `connect-go`, Postgres, Redis for rate limiting

**Key responsibilities:**
- WebAuthn registration and authentication
- Session token issuance (short-lived JWT) and refresh
- Recovery flow orchestration (delegates SMS to Twilio Verify, email to Postmark)
- Tier transitions and KYC orchestration (delegates IDV to Persona/Onfido/Stripe Identity)
- Sanctions screening on identity events (TRM Labs API)

### Wallet Service

Owns the mapping between Goemon Global Finance users and Hedera accounts, transaction construction, signing orchestration, and the server-side components of the native wallet stack. The most security-critical service after Ledger.

**Tech:** Go, official Hedera Go SDK, Postgres, Redis, Kafka producer, AWS KMS for paymaster and HMAC backup factor signing

**Key responsibilities:**
- Hedera account creation on user signup (paymaster-funded)
- Transaction construction for client signing (HTS transfers, HSCS calls, HCS submissions)
- Co-signing for 2-of-2 threshold key operations (step-up auth)
- Gas sponsorship via paymaster account with policy-based fee approval
- Mirror Node subscription for inbound transfer detection (own mirror node deployment)
- Balance query, caching, and aggregation
- Backup Custodian: storage and retrieval of encrypted backup blobs, multi-factor unlock orchestration
- Key rotation: orchestrating Hedera account key updates when users add/remove devices

**Sub-services:**
- **Account Service** — Hedera account lifecycle (create, key-add, key-rotate, key-remove)
- **Signer Service** — server-side co-signing for step-up operations; KMS-isolated
- **Paymaster Service** — gas sponsorship, fee policy enforcement, paymaster balance management
- **Backup Custodian** — encrypted blob storage, recovery factor verification, blob rotation on device changes
- **Mirror Indexer** — consumes Hedera Mirror Node stream, indexes balance and transaction events to Postgres/Kafka

**Client SDKs (built by mobile and web teams, consume Wallet Service APIs):**
- **iOS Wallet Kit** — Swift package wrapping Hedera iOS SDK; integrates with Secure Enclave for key generation and signing; exposes a clean API to the iOS app
- **Android Wallet Kit** — Kotlin module wrapping Hedera Android SDK; integrates with Android Keystore (StrongBox preferred); exposes a clean API to the Android app
- **Web Wallet Kit** — TypeScript package wrapping Hedera JS SDK; uses WebAuthn for credential binding and browser secure context for ephemeral signing keys

This is the largest engineering workstream in Phase 0 and Phase 1. Estimated 3 senior engineers full-time for 4-5 months (1 backend, 1 iOS, 1 Android), with part-time web and SRE support. External security audit is mandatory before Phase 2 traffic; budget for two audit rounds plus ongoing penetration testing.

### Marketplace Service

Owns listings, order placement, trade execution, pricing.

**Tech:** Go, Postgres, Redis, Kafka, Chainlink data feeds via web3 RPC

**Key responsibilities:**
- Listing CRUD (admin-facing) and read (user-facing)
- Order placement and matching engine for secondary trades
- Integration with external issuers (Securitize, Ondo, Centrifuge, Courtyard, etc.)
- Pricing aggregation from multiple sources
- Compliance pre-check on every order (Identity Registry status, jurisdiction, accreditation)

### Payments Service

Owns fiat rails, international corridors, partner bank integration.

**Tech:** Go, Postgres, Temporal client, integrations with partner bank API and corridor partners

**Key responsibilities:**
- ACH/wire/FedNow execution via partner bank
- Corridor execution via off-ramp partners
- Settlement reconciliation with partner bank and corridor partners
- USDC ↔ USD conversion orchestration

### Ledger Service

Owns the double-entry accounting system that tracks every money movement in the system. The most security-critical service.

**Tech:** Go, Postgres with serializable isolation, integer-cents arithmetic only, no floating point anywhere

**Key responsibilities:**
- Double-entry journal: every monetary movement is two rows (debit + credit), summed by account
- Reconciliation pipelines (Hedera Mirror Node vs ledger; partner bank statement vs ledger; corridor partner settlement vs ledger)
- Balance queries (always derived from ledger, never cached without versioning)
- Atomic multi-leg operations (e.g., USDC + USD swap is a four-row transaction)

### Audit Service

Owns the append-only audit log for compliance and forensics.

**Tech:** Go, Postgres for hot store, HCS for immutable anchor, ClickHouse for query

**Key responsibilities:**
- Every state-changing operation in any service emits an audit event
- Events are written to Postgres (queryable) and periodically batched to HCS (immutable, cryptographically verifiable)
- Compliance queries (give me everything user X did between dates A and B) hit ClickHouse
- Audit log is append-only; SQL triggers block UPDATE and DELETE

### Notification Service

Owns push notifications, email, and (security-only) SMS.

**Tech:** Go, integrations with Apple Push Notification, Firebase Cloud Messaging, Postmark/SendGrid, Twilio

### Customer Support Service

Owns ticketing, conversation state, and the interface between users and the support agent (which itself lives in Conductor OSS).

**Tech:** Go, Postgres, Conductor workflow trigger

## Workflow orchestration

### Temporal — money movement

Every operation that touches money is a Temporal workflow. Durable execution means we get retry, compensation, and idempotency for free.

Workflows defined in v1:
- `UserSignup` — wallet creation + welcome email + sanctions screen
- `KYCUpgrade` — IDV vendor call + sanctions rescreen + tier transition + on-chain identity registry update
- `USDCSend` — fee quote + compliance check + on-chain submission + ledger entry + notification
- `USDCReceive` — Mirror Node event + sanctions check + ledger entry + notification
- `MarketplacePurchase` — order validation + USDC escrow + asset transfer + settlement + ledger entry
- `ACHDeposit` — partner bank notification + ledger entry + USDC conversion if requested
- `ACHWithdrawal` — withdrawal request + partner bank execution + return handling
- `CorridorSendOutbound` — quote lock + USDC escrow + partner execution + settlement confirmation
- `Reconciliation` — daily/hourly reconciliation runs against partner systems

Workflows are Go code with Temporal's Go SDK. Activities are stateless functions that can be retried.

**Requirements:**
- `[REQ-TECH-T-001]` All workflows are idempotent at the activity level
- `[REQ-TECH-T-002]` Money-moving workflows persist their state at every step; a restart of any service mid-workflow does not result in duplicate or lost transactions
- `[REQ-TECH-T-003]` Temporal cluster is deployed in HA configuration across at least 3 nodes
- `[REQ-TECH-T-004]` Workflow execution metrics flow to observability stack (latency, success rate, retry counts)

### Conductor OSS — agent workflows

Conductor OSS handles workflows where an LLM agent is a participant. Conductor's JSON-defined workflows and native LLM/MCP tasks make this cleaner than Temporal.

Workflows defined in v1:
- `SupportTicketTriage` — incoming ticket → agent classifies → routes to specialist agent or human
- `KYCManualReview` — IDV confidence below threshold → agent gathers context → human reviewer approves/denies
- `FraudAlert` — transaction monitoring signal → agent investigates → escalates or clears
- `MarketingCampaignDraft` — campaign brief → agent drafts content → human approves → notification service sends
- `IncidentResponse` — alert fires → agent does first-pass triage → routes to on-call
- `RWAListingDueDiligence` — new asset proposal → agent gathers public information → compliance reviews → listing approved or rejected

**Requirements:**
- `[REQ-TECH-C-001]` Each Conductor workflow that involves user-impacting actions has a clearly defined human-approval step before any destructive action
- `[REQ-TECH-C-002]` Agent tool calls are scoped per skill (Module 08); a marketing agent cannot call a payments tool
- `[REQ-TECH-C-003]` Conductor cluster runs separately from Temporal cluster (independent failure domains)

## Data layer

### Postgres (primary ledger and state)

- AWS Aurora Postgres (or GCP CloudSQL — multi-cloud capable)
- Multi-AZ deployment, automated failover
- Read replicas for query-heavy services (Marketplace browsing)
- Daily snapshot, point-in-time recovery, 7-year retention for financial records

**Schema highlights:**
- `ledger_accounts` — one row per Goemon Global Finance-tracked account (user USDC balance, user USD balance, escrow accounts, fee accounts, etc.)
- `ledger_entries` — append-only; every row is a debit or credit; idempotent via `external_ref`
- `users`, `passkeys`, `sessions`, `kyc_tiers` — auth service
- `listings`, `orders`, `trades` — marketplace
- `audit_events` — append-only; triggers block UPDATE/DELETE
- `compliance_holds`, `sanctioned_addresses`, `frozen_accounts` — compliance

### Redis (cache and rate limiting)

- AWS ElastiCache, cluster mode
- Used for: session caching, rate limiting (per-user and per-IP), Mirror Node response caching, marketplace listing caching

### Kafka / Redpanda (event streaming)

- Used for: cross-service event propagation, async processing pipelines, analytics export
- Topics: `user_events`, `wallet_events`, `marketplace_events`, `payment_events`, `audit_events` (write-only, fed to ClickHouse + HCS)

### ClickHouse (analytics and audit query)

- Self-hosted in v1 (AWS EC2 + EBS), managed by Altinity if needed
- Fed from Kafka
- Used for: compliance queries, business intelligence, fraud detection model training data, financial reporting

### Hedera Mirror Nodes

- We run our own Hedera Mirror Node for low-latency reads (instead of relying on public mirror node)
- Indexes the entire Hedera state we care about
- Used for: balance queries (with Redis cache), inbound transfer detection (via subscription), audit verification

## Cloud and deployment

### Cloud strategy

- **Primary cloud:** AWS for v1
- **Cloud-portable architecture:** Kubernetes (EKS in v1) for compute; standard Postgres for database; Kafka/Redpanda; S3-compatible object storage
- **Infrastructure as code:** Pulumi (we use Go for IaC since the team already speaks Go)
- **Multi-cloud capable:** all components run on GCP and Azure when data residency demands it

### Regions

- **US:** us-east-1 (primary), us-west-2 (DR)
- **EU:** eu-west-1 (when EU users come online, v2)
- **APAC:** ap-southeast-1 (when Philippines/Indonesia traffic justifies, v2)
- **LatAm:** Multi-region via Cloudflare CDN, primary processing in us-east-1 with selective Pix routing via local provider

### CI/CD

- GitHub Actions for CI
- ArgoCD for continuous deployment to Kubernetes
- Feature flags via OpenFeature (LaunchDarkly-style); every new user-facing feature ships behind a flag
- Production deploys require: green tests, code review, change ticket, and (for money-touching services) a separate approval

### Observability

- **Logs:** structured JSON, shipped to Datadog or equivalent
- **Metrics:** Prometheus + Grafana
- **Traces:** OpenTelemetry, sampling at 10% for normal traffic, 100% for error paths
- **Alerts:** PagerDuty, with severity-based routing (SEV1 → on-call human + agent triage; SEV2 → agent triage with human fallback)

## Performance and scale

### v1 targets

- **Sustained API throughput:** 1,000 RPS at launch with capacity for 10x burst
- **P99 API latency:** <250ms for read operations, <500ms for write operations
- **Daily active users (DAU) supported:** 250K at v1 (assuming 25% DAU/MAU ratio at 1M MAU)
- **Hedera transaction throughput required:** ~50 TPS sustained at 1M users (well within Hedera's 10K TPS capacity)
- **Database load:** ~5K queries/sec at 1M MAU (handleable on Aurora r6i.4xlarge with read replicas)

### Scale-out plan

- **API tier:** Horizontal pod autoscaling on Kubernetes; stateless services scale linearly
- **Postgres:** Read replicas first, then schema-level partitioning by user_id once ledger exceeds ~100M rows
- **Kafka:** Add partitions and brokers
- **Hedera:** Hedera scales independently; we just consume more capacity
- **Mirror Node:** Add more mirror node instances behind a load balancer

## Security

### Critical security requirements

- `[REQ-TECH-SEC-001]` All API traffic uses TLS 1.3 with certificate pinning on mobile clients
- `[REQ-TECH-SEC-002]` Service-to-service traffic uses mTLS within the cluster
- `[REQ-TECH-SEC-003]` All secrets stored in AWS Secrets Manager or HashiCorp Vault; never in code or environment variables in source
- `[REQ-TECH-SEC-004]` Database access requires service identity (IAM-based), not static credentials
- `[REQ-TECH-SEC-005]` All PII fields are encrypted at the application layer with field-level encryption; only hashed lookups
- `[REQ-TECH-SEC-006]` Hedera private keys (paymaster, multisig signers) are stored in AWS KMS / CloudHSM; signing happens inside KMS, keys never leave
- `[REQ-TECH-SEC-007]` Production deploys require change ticket and reviewer approval; emergency hotfixes require sign-off from on-call eng lead
- `[REQ-TECH-SEC-008]` Annual penetration testing by external firm; quarterly internal security review
- `[REQ-TECH-SEC-009]` SOC 2 Type II audit begins at v1 launch, target completion 12 months post-launch
- `[REQ-TECH-SEC-010]` Vulnerability scanning on container images at build time and continuously in production

### Threat modeling

Key threat scenarios documented and mitigated:

- **Compromised user device:** mitigated by hardware-bound keys (Secure Enclave / Keystore), per-tx biometric, withdrawal holds on new device, rate limits
- **SIM swap:** mitigated by SMS used only for low-trust recovery, 24-hour withdrawal hold after SMS-bootstrapped login, MFA recovery requires multiple factors not just SMS
- **Insider threat:** mitigated by least-privilege IAM, audit logging of all admin actions, segregation of duties for high-value operations; recovery operations require multi-person approval
- **Backup Custodian compromise:** mitigated by double-encryption of backup blobs (passkey-derived inner key + KMS-held HMAC outer factor); compromise of our servers alone does not yield user keys
- **Hedera SDK vulnerability:** mitigated by version pinning, dependency review process, ability to roll forward quickly; native build means we are not exposed to embedded-wallet-vendor-side bugs but we are responsible for keeping the Hedera SDK current
- **Partner bank failure:** mitigated by deposit insurance, daily reconciliation, contractual hot-swap to backup partner (provisioned but not active in v1)
- **Hedera network failure:** mitigated by transaction queueing in our service layer; degraded mode where pending transactions are visible to users with status messaging
- **Stablecoin issuer issue (USDC depeg):** mitigated by Chainlink proof-of-reserve monitoring + circuit breaker pattern (we pause USDC deposits if depeg exceeds X% for Y minutes)
- **Native wallet build introduces our own bugs:** mitigated by mandatory external security audits (2 rounds before Phase 2), bug bounty program live at beta, conservative rollout (closed alpha → 1% open beta → full beta), and a 24-hour wallet circuit breaker that can pause all signing operations if a critical issue is detected

## Open questions

- `[Q-TECH-001]` Run our own Conductor OSS cluster or use Orkes Cloud? Cloud has lower ops overhead; OSS gives us control and lower long-run cost
- `[Q-TECH-002]` Aurora vs CockroachDB for the ledger? CockroachDB has better multi-region semantics; Aurora is more battle-tested
- `[Q-TECH-003]` Run Hedera Mirror Node ourselves or pay for managed (Arkhia, etc.)? Self-hosted gives latency + cost wins at scale, managed accelerates v1

## Cross-references

- For agent workflows on Conductor specifically, see [08 — Agent Operations](./08-agent-operations.md)
- For security and compliance crossover, see [09 — Compliance & Jurisdictions](./09-compliance-and-jurisdictions.md)
- For deployment phasing, see [10 — Roadmap & Phasing](./10-roadmap-and-phasing.md)
