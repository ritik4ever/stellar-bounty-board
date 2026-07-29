// variables.tf

variable "environment" {
  description = "Deployment environment (staging or production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be either 'staging' or 'production'"
  }
}

variable "project_name" {
  description = "Name of the project/application"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "service_name" {
  description = "Name of the backend service"
  type        = string
}

variable "container_image" {
  description = "Docker image for the service"
  type        = string
}

variable "container_port" {
  description = "Port the container listens on"
  type        = number
  default     = 80
}

variable "environment_variables" {
  description = "Map of environment variable name/value pairs"
  type        = map(string)
  default     = {}
}

variable "desired_count" {
  description = "Number of task instances"
  type        = number
  default     = 1
}

variable "subnet_ids" {
  description = "List of subnet IDs for the ECS service"
  type        = list(string)
}

variable "security_group_ids" {
  description = "List of security group IDs for the ECS service"
  type        = list(string)
}

variable "execution_role_arn" {
  description = "ARN of the IAM role for task execution"
  type        = string
}

variable "task_role_arn" {
  description = "ARN of the IAM role for the task"
  type        = string
}

# Database variables
variable "db_name" {
  description = "Database name"
  type        = string
}

variable "db_username" {
  description = "Database username"
  type        = string
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage (GB) for the DB"
  type        = number
  default     = 20
}

variable "db_security_group_ids" {
  description = "Security groups for the DB"
  type        = list(string)
}

variable "db_subnet_group_name" {
  description = "Subnet group name for the DB"
  type        = string
}

variable "tfc_organization" {
  description = "Terraform Cloud organization for remote backend"
  type        = string
}

variable "tfc_workspace" {
  description = "Terraform Cloud workspace name"
  type        = string
}
