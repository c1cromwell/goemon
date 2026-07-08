# Application secrets in Secret Manager. Cloud Run reads them at boot as env vars
# (see cloudrun.tf); the runtime service account is granted accessor on each below.

# --- generated app secrets ---
resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "random_password" "admin_jwt" {
  length  = 48
  special = false
}

# --- DATABASE_URL over the Cloud SQL unix socket ---
# node-postgres (pg-connection-string) accepts ?host=<socket dir> for unix sockets.
locals {
  database_url = "postgres://${google_sql_user.goemon.name}:${random_password.db.result}@/${google_sql_database.goemon.name}?host=/cloudsql/${google_sql_database_instance.pg.connection_name}"
}

locals {
  secret_values = {
    JWT_SECRET       = random_password.jwt.result
    ADMIN_JWT_SECRET = random_password.admin_jwt.result
    DATABASE_URL     = local.database_url
  }
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secret_values
  secret_id = "${var.service_name}-${lower(replace(each.key, "_", "-"))}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = local.secret_values
  secret      = google_secret_manager_secret.app[each.key].id
  secret_data = each.value
}

# --- HEDERA_OPERATOR_KEY placeholder ---
# The wrapped (gcm.v1.gcp.<ct>) operator key is created OUT OF BAND after the KMS
# key exists: run `npm run wrap-secret` against the KMS key, then add a version:
#   gcloud secrets versions add goemon-backend-hedera-operator-key --data-file=-
# Terraform only creates the empty secret container so IAM + the env wiring exist.
resource "google_secret_manager_secret" "hedera_operator_key" {
  secret_id = "${var.service_name}-hedera-operator-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}
