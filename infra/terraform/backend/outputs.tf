// outputs.tf

output "service_endpoint" {
  description = "URL of the deployed backend service"
  value       = "${aws_ecs_service.service.load_balancer[0].dns_name}" // placeholder if using ALB
}

output "database_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.database.endpoint
}

output "database_port" {
  description = "RDS instance port"
  value       = aws_db_instance.database.port
}
