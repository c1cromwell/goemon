# Docker repository the CI pipeline pushes backend images to.
resource "google_artifact_registry_repository" "backend" {
  location      = var.region
  repository_id = var.service_name
  description   = "Goemon backend container images"
  format        = "DOCKER"

  depends_on = [google_project_service.enabled]
}
