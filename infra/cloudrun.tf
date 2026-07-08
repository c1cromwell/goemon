# Cloud Run service (the API) + a one-shot Cloud Run Job that runs DB migrations.

resource "google_cloud_run_v2_service" "backend" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  # Stateless service — allow terraform/CI to replace it freely.
  deletion_protection = false

  template {
    service_account = google_service_account.run.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # Mount the Cloud SQL connector so DATABASE_URL's ?host=/cloudsql/... resolves.
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.pg.connection_name]
      }
    }

    containers {
      image = var.image

      ports {
        container_port = 3001
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      # --- plain config ---
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "3001"
      }
      env {
        name  = "KMS_PROVIDER"
        value = "gcp"
      }
      env {
        name  = "KMS_KEY_NAME"
        value = google_kms_crypto_key.backend.id
      }
      env {
        name  = "CORS_ORIGIN"
        value = var.cors_origin
      }

      # --- secrets (read from Secret Manager at boot) ---
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["JWT_SECRET"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "ADMIN_JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["ADMIN_JWT_SECRET"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["DATABASE_URL"].secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 3001
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 6
      }
      liveness_probe {
        http_get {
          path = "/api/health"
          port = 3001
        }
        period_seconds = 30
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_version.app,
    google_secret_manager_secret_iam_member.run_app_secrets,
  ]
}

# Public reachability. The app enforces its own auth (passkeys / scoped tokens);
# Cloud Run invoker is opened to allow the public API surface. Restrict this if you
# front the service with a load balancer + IAP instead.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.backend.name
  location = google_cloud_run_v2_service.backend.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Migration job — run once per deploy BEFORE routing traffic to a new revision:
#   gcloud run jobs execute goemon-backend-migrate --region us-central1 --wait
resource "google_cloud_run_v2_job" "migrate" {
  name     = "${var.service_name}-migrate"
  location = var.region

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.run.email

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.pg.connection_name]
        }
      }

      containers {
        image   = var.image
        command = ["node", "dist/db/migrate.js"]

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
        # migrate.ts imports config → productionFatals runs under NODE_ENV=production,
        # so the job must satisfy the same gate as the service (JWT + ADMIN_JWT
        # present & distinct, a real KMS provider). All *_ENABLED flags default off.
        env {
          name = "JWT_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["JWT_SECRET"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "ADMIN_JWT_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["ADMIN_JWT_SECRET"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name  = "KMS_PROVIDER"
          value = "gcp"
        }
        env {
          name  = "KMS_KEY_NAME"
          value = google_kms_crypto_key.backend.id
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_version.app,
    google_secret_manager_secret_iam_member.run_app_secrets,
  ]
}
