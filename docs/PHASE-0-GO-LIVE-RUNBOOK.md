# Phase 0 — Go-Live Unblock Runbook (GCP)

Companion to `docs/business/TOKENIZATION-GO-LIVE-STRATEGY.md` §7. This is the concrete
"unblock" phase: license, real KMS custody, container, IaC, CI/CD. Target cloud is
**GCP** (Cloud Run · Cloud SQL · Cloud KMS · Secret Manager · Artifact Registry).

## What Phase 0 delivered (in this repo)

| Item | Where | Status |
|---|---|---|
| Proprietary LICENSE | `LICENSE` | ✅ done |
| Real GCP KMS provider (wrap/unwrap via Cloud KMS, AAD-bound) | `backend/src/services/keyVaultService.ts` (`gcpKmsProvider`) | ✅ done + tested (`test/kms-gcp.test.ts`) |
| `KMS_KEY_NAME` config + `gcp`-without-key prod-fatal | `backend/src/config.ts` | ✅ done |
| Backend Dockerfile (multi-stage, non-root, health-checked) | `backend/Dockerfile` | ✅ builds |
| Local end-to-end smoke stack | `backend/docker-compose.local.yml` | ✅ boots on Postgres |
| Postgres migration compatibility fix | `backend/src/db/migrations/027–031` (`datetime('now')`→`CURRENT_TIMESTAMP`) | ✅ all 53 migrations apply on Postgres |
| Logger fallback when `pino-pretty` absent | `backend/src/observability/logger.ts` | ✅ done |
| Terraform (GCP) | `infra/` | ⏳ apply-ready, not yet applied |
| CI (typecheck·test·build·image) | `.github/workflows/ci.yml` | ⏳ activates on first push |
| Deploy (build→push→migrate→deploy) | `.github/workflows/deploy.yml` | ⏳ needs WIF setup |

**Verified locally:** image builds; container boots against Postgres; **all 53 migrations apply on Postgres** (previously dead at `027`); `/api/health` → `{"status":"ok","dialect":"postgres"}`; full test suite **457 pass / 3 todo**.

> **Go-live finding:** migrations 027–031 used SQLite-only `datetime('now')`, so the full schema had **never applied on Postgres** — production would have failed at first migrate. Fixed. Re-scan before each release: `grep -rlE "datetime\(|strftime|julianday|AUTOINCREMENT" backend/src/db/migrations/*.sql` should return nothing.

---

## Reproduce the local smoke test

```bash
cd backend
docker compose -f docker-compose.local.yml up --build
# in another shell:
curl localhost:3001/api/health     # {"status":"ok","dialect":"postgres","env":"development"}
docker compose -f docker-compose.local.yml down -v
```

Runs `NODE_ENV=development` on purpose — a true production boot is prod-fatal on
`KMS_PROVIDER=local` and needs a real Cloud KMS key + secrets, which live in the cloud.

---

## Provision GCP (one time)

### 0. Prerequisites
```bash
gcloud auth login
gcloud config set project <PROJECT_ID>
# state bucket for terraform (recommended):
gcloud storage buckets create gs://goemon-tfstate-<PROJECT_ID> --location=us-central1 --uniform-bucket-level-access
```
Then uncomment the `backend "gcs"` block in `infra/versions.tf` and set the bucket.

### 1. First apply — registry first, then the rest
The Cloud Run service needs an image that already exists, so bootstrap in two passes.

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # edit project_id, region, image, cors_origin
terraform init

# pass 1 — create just the Artifact Registry repo + KMS (needed to push + wrap)
terraform apply -target=google_artifact_registry_repository.backend -target=google_kms_crypto_key.backend
```

### 2. Build & push the bootstrap image
```bash
REGION=us-central1 ; PROJECT=<PROJECT_ID>
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet
docker build -t ${REGION}-docker.pkg.dev/${PROJECT}/goemon-backend/backend:bootstrap ../backend
docker push  ${REGION}-docker.pkg.dev/${PROJECT}/goemon-backend/backend:bootstrap
# set image = "...:bootstrap" in terraform.tfvars
```

### 3. Apply the rest
```bash
terraform apply
# note the outputs: service_url, kms_key_name, sql_connection_name, migrate_job_name
```

### 4. Run migrations, then confirm health
```bash
gcloud run jobs execute goemon-backend-migrate --region ${REGION} --wait
curl -fsS "$(terraform output -raw service_url)/api/health"   # {"status":"ok","dialect":"postgres","env":"production"}
```

---

## Production Hedera operator key (when you enable Hedera — Phase 1)

The operator key must be **KMS-wrapped** (`config.ts` is prod-fatal on a raw key). Wrap it
against the Terraform-created KMS key, then store the blob as a secret version:

```bash
cd backend
export KMS_PROVIDER=gcp
export KMS_KEY_NAME="$(cd ../infra && terraform output -raw kms_key_name)"
# GOOGLE_APPLICATION_CREDENTIALS must point at creds with cryptoKeyEncrypterDecrypter on the key.
npm run wrap-secret -- "<raw ED25519/ECDSA operator private key>"
# copy the printed gcm.v1.gcp.<...> blob into the secret:
printf '%s' 'gcm.v1.gcp.XXXX' | gcloud secrets versions add goemon-backend-hedera-operator-key --data-file=-
```
Then add `HEDERA_ENABLED=true`, `HEDERA_NETWORK=mainnet`, `HEDERA_OPERATOR_ID`, a real
`HEDERA_USDC_TOKEN_ID`, and wire `HEDERA_OPERATOR_KEY` from that secret onto the Cloud Run
service (add an `env { value_source { secret_key_ref … } }` block in `infra/cloudrun.tf`).
Details in the strategy doc §7.2.

---

## Wire CI/CD (one time)

1. Push the repo to GitHub. `ci.yml` runs immediately on PRs/`main` (typecheck · test · build · image).
2. Set up **Workload Identity Federation** for `deploy.yml` (no JSON keys):
   see google-github-actions/auth. Create a `github-deployer` service account with:
   `roles/run.admin`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`,
   `roles/cloudsql.client`.
3. Add repo **Variables**: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`,
   `GCP_DEPLOY_SA`, `CLOUD_RUN_SERVICE=goemon-backend`.
4. Merges to `main` now build → push → run the migrate job → deploy → smoke-check `/api/health`.

> **CI note:** `scripts/launch-gate.sh` is the *local/macOS* gate (it also verifies the iOS
> wallet, which needs Xcode). Linux CI runs the portable subset (typecheck · test · build ·
> image) directly.

---

## Cost floor (this stack, low volume)

- Cloud SQL `db-custom-1-3840` REGIONAL (HA) ≈ the biggest line — drop to ZONAL +
  `db-f1-micro` for staging.
- Cloud Run scales to `min_instances` (default 1 warm) — set `min_instances=0` to scale to zero.
- Cloud KMS ≈ $0.06/key/month + $0.03 per 10k ops — effectively free.
- Secret Manager ≈ $0.06 per active secret version/month.

Rough production floor: **low four figures/month**; staging can be **~$50–150/month**.

---

## Next: Phase 1 — Hedera mainnet + custody

See `docs/business/TOKENIZATION-GO-LIVE-STRATEGY.md` §7.2/§7.3 and §7.6. Highlights:
create a mainnet operator (ECDSA where KMS signs), wrap the key (above), close custody
invariant *m* with a Hedera **threshold KeyList**, and **self-host a Mirror Node** for the
reconciliation loop.
