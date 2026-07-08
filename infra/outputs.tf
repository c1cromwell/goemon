output "service_url" {
  description = "Public URL of the Cloud Run backend."
  value       = google_cloud_run_v2_service.backend.uri
}

output "image_repo" {
  description = "Artifact Registry path to push backend images to."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.backend.repository_id}"
}

output "sql_connection_name" {
  description = "Cloud SQL instance connection name (PROJECT:REGION:INSTANCE)."
  value       = google_sql_database_instance.pg.connection_name
}

output "kms_key_name" {
  description = "Full KMS crypto-key resource name — set as KMS_KEY_NAME and wrap the Hedera operator key against it."
  value       = google_kms_crypto_key.backend.id
}

output "runtime_service_account" {
  description = "Runtime service account email for the Cloud Run service/job."
  value       = google_service_account.run.email
}

output "migrate_job_name" {
  description = "Cloud Run Job that applies DB migrations."
  value       = google_cloud_run_v2_job.migrate.name
}
