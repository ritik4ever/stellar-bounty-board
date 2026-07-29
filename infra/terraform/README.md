# Terraform Backend Service Module

This directory contains the Terraform module that provisions the backend service, database, and environment variables.

## Usage
```hcl
module "backend" {
  source      = "./backend"
  environment = var.environment
  # other variables ...
}
```

Run the usual Terraform workflow:
```bash
terraform init      # initialize backend (remote state is configured in backend.tf)
terraform plan -var="environment=staging"
terraform apply -var="environment=staging"
```

## Remote State
The remote state backend is configured in `backend.tf`. It can be switched between Terraform Cloud or an S3-compatible backend by setting the appropriate variables.

## Variables
See `backend/variables.tf` for a full list of inputs. The `environment` variable determines which set of defaults (staging vs production) is used.

## Outputs
After apply, the module exports useful outputs such as the service endpoint. See `backend/outputs.tf`.

## Documentation
Additional documentation is provided in the module's README.
