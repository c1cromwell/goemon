# Frontend — the Vite SPA served by nginx on Cloud Run (public, scale-to-zero).
# Static assets only; no DB/KMS/secret access, so it runs on the default runtime SA.
# CORS: after first deploy, add this service's URL to the backend's CORS_ORIGIN.
resource "google_cloud_run_v2_service" "frontend" {
  name     = "${var.service_name}-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  deletion_protection = false

  template {
    scaling {
      min_instance_count = 0 # static SPA — fine to cold-start
      max_instance_count = var.max_instances
    }
    containers {
      image = var.frontend_image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
      }
      startup_probe {
        tcp_socket {
          port = 8080
        }
      }
    }
  }

  depends_on = [google_project_service.enabled]
}

# Public — it's a static web app.
resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  name     = google_cloud_run_v2_service.frontend.name
  location = google_cloud_run_v2_service.frontend.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
