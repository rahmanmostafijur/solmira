resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = [for subnet in aws_subnet.data : subnet.id]
}

resource "random_password" "redis" {
  length  = 48
  special = false
}

# Rate limit counters, the revocation list and the per-endpoint rate limit live here. Losing the cache
# loses counters, not data: the services allow requests when it is unavailable (ADR-0030).
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = local.name
  description          = "Solmira rate limits and token revocations"
  engine               = "valkey"
  engine_version       = var.redis_engine_version
  node_type            = var.redis_node_type
  port                 = 6379

  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result

  snapshot_retention_limit   = 3
  snapshot_window            = "01:00-02:00"
  maintenance_window         = "sun:04:30-sun:05:30"
  auto_minor_version_upgrade = true
}
