# Cloud KMS crypto key that backs keyVaultService's gcp provider. The key never
# leaves KMS; the DB stores only KMS ciphertext (closes invariant m for real).
# Set KMS_PROVIDER=gcp and KMS_KEY_NAME=<this key's id> on the backend (done in
# cloudrun.tf) — and wrap HEDERA_OPERATOR_KEY with `npm run wrap-secret` against it.
resource "google_kms_key_ring" "goemon" {
  name     = "goemon"
  location = var.region

  depends_on = [google_project_service.enabled]
}

resource "google_kms_crypto_key" "backend" {
  name            = "backend"
  key_ring        = google_kms_key_ring.goemon.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = var.kms_rotation_period

  # A crypto key cannot be truly deleted; guard against accidental destroy.
  lifecycle {
    prevent_destroy = true
  }
}
