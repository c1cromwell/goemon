# Cloud SQL for PostgreSQL — the ledger's system of record.
resource "google_sql_database_instance" "pg" {
  name             = "${var.service_name}-pg"
  region           = var.region
  database_version = "POSTGRES_16"

  deletion_protection = var.deletion_protection

  settings {
    tier              = var.db_tier
    availability_type = var.db_availability_type
    disk_type         = "PD_SSD"
    disk_size         = 20
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "07:00"
    }

    ip_configuration {
      # No public IP. Cloud Run reaches it over the built-in Cloud SQL connector
      # (unix socket mounted at /cloudsql), so no VPC connector is required.
      ipv4_enabled = false
      # Private IP requires a VPC + service networking peering; the socket path
      # avoids that. If you later want private IP, add private_network here.
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_sql_database" "goemon" {
  name     = "goemon"
  instance = google_sql_database_instance.pg.name
}

# App DB user. Alphanumeric password (special=false) so it needs no URL-encoding
# inside the DATABASE_URL connection string.
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "goemon" {
  name     = "goemon"
  instance = google_sql_database_instance.pg.name
  password = random_password.db.result
}
