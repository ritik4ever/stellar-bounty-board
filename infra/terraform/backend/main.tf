# Main Terraform configuration for backend service

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# Example ECS/Fargate service (placeholder)
resource "aws_ecs_cluster" "backend" {
  name = "${var.project_name}-${var.environment}-cluster"
}

resource "aws_ecs_task_definition" "service" {
  family                   = "${var.project_name}-${var.environment}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name  = var.service_name
      image = var.container_image
      portMappings = [{
        containerPort = var.container_port
        hostPort      = var.container_port
        protocol      = "tcp"
      }]
      environment = var.environment_variables
    }
  ])
}

resource "aws_ecs_service" "service" {
  name            = "${var.project_name}-${var.environment}-service"
  cluster         = aws_ecs_cluster.backend.id
  task_definition = aws_ecs_task_definition.service.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = var.subnet_ids
    security_groups = var.security_group_ids
    assign_public_ip = true
  }
}

# Example RDS PostgreSQL instance (placeholder)
resource "aws_db_instance" "database" {
  identifier = "${var.project_name}-${var.environment}-${var.db_name}"
  engine     = "postgres"
  instance_class = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  name       = var.db_name
  username   = var.db_username
  password   = var.db_password
  skip_final_snapshot = true
  publicly_accessible  = false
  vpc_security_group_ids = var.db_security_group_ids
  db_subnet_group_name = var.db_subnet_group_name
}
