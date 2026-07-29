// backend.tf
terraform {
  backend "remote" {
    organization = var.tfc_organization
    workspaces {
      name = var.tfc_workspace
    }
  }
}
