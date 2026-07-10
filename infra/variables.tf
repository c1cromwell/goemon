variable "project_id" {
  type        = string
  description = "GCP project id that hosts the Goemon backend."
}

variable "region" {
  type        = string
  description = "Region for Cloud Run, Cloud SQL, KMS, and Artifact Registry."
  default     = "us-central1"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name (also the Artifact Registry repo name)."
  default     = "goemon-backend"
}

variable "image" {
  type        = string
  description = <<-EOT
    Full container image ref to deploy, e.g.
    us-central1-docker.pkg.dev/PROJECT/goemon-backend/backend:GIT_SHA
    On the first apply, push an image first (see infra/README.md) or set this to a
    placeholder and let CI update the Cloud Run revision.
  EOT
}

variable "frontend_image" {
  type        = string
  description = <<-EOT
    Full container image ref for the frontend Cloud Run service, e.g.
    us-central1-docker.pkg.dev/PROJECT/goemon-backend/frontend:GIT_SHA
    Built with a VITE_API_BASE build-arg = the backend's public /api URL (Vite inlines it).
    Placeholder on first apply; CI updates the revision.
  EOT
  default     = "us-docker.pkg.dev/cloudrun/container/hello" # harmless placeholder until CI pushes a real image
}

variable "db_tier" {
  type        = string
  description = "Cloud SQL machine tier. db-custom-1-3840 = 1 vCPU / 3.75GB (a sane small-prod floor)."
  default     = "db-custom-1-3840"
}

variable "db_availability_type" {
  type        = string
  description = "REGIONAL = Multi-AZ HA (production); ZONAL = single zone (cheaper, staging)."
  default     = "REGIONAL"
}

variable "max_instances" {
  type        = number
  description = "Cloud Run max instances (autoscaling ceiling)."
  default     = 4
}

variable "min_instances" {
  type        = number
  description = "Cloud Run min instances. 0 scales to zero (cold starts); 1 keeps one warm."
  default     = 1
}

variable "deletion_protection" {
  type        = bool
  description = "Guard the Cloud SQL instance against accidental terraform destroy."
  default     = true
}

variable "cors_origin" {
  type        = string
  description = "Comma-separated allowed browser origins for the API."
  default     = "https://app.goemonglobal.com"
}

variable "kms_rotation_period" {
  type        = string
  description = "Cloud KMS crypto-key rotation period (seconds form). 7776000s = 90 days."
  default     = "7776000s"
}
