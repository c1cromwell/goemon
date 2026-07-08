# Runtime identity for the Cloud Run service (least privilege).
resource "google_service_account" "run" {
  account_id   = "${var.service_name}-run"
  display_name = "Goemon backend (Cloud Run runtime)"
}

# Connect to Cloud SQL.
resource "google_project_iam_member" "run_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.run.email}"
}

# Encrypt/decrypt through the key-vault KMS key (wrap/unwrap at-rest secrets).
resource "google_kms_crypto_key_iam_member" "run_kms" {
  crypto_key_id = google_kms_crypto_key.backend.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.run.email}"
}

# Read each app secret (per-secret grant, not project-wide accessor).
resource "google_secret_manager_secret_iam_member" "run_app_secrets" {
  for_each  = google_secret_manager_secret.app
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "run_hedera_key" {
  secret_id = google_secret_manager_secret.hedera_operator_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}
