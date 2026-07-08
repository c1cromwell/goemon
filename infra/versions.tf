terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.30, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5"
    }
  }

  # Remote state. Create the bucket once (see infra/README.md) then uncomment.
  # backend "gcs" {
  #   bucket = "goemon-tfstate-CHANGE_ME"
  #   prefix = "backend"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
