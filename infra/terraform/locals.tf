locals {
  name = "${var.name_prefix}-${var.environment}"

  tags = {
    Project     = "solmira"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # Every container service and the port it listens on.
  service_ports = {
    web          = 3000
    identity     = 4001
    ingest       = 4002
    notification = 4003
    analytics    = 4004
    audit        = 4005
    dispatcher   = 4006
  }

  # The databases and the roles of each (ADR-0012): the owner migrates, the app role is what the
  # service runs as and what Row Level Security applies to. The dispatcher has its own narrow role on
  # the ingest database (ADR-0031).
  database_services = ["identity", "ingest", "notification", "analytics", "audit"]
  database_roles = concat(
    flatten([for s in local.database_services : ["${s}_owner", "${s}_app"]]),
    ["dispatcher_app"],
  )

  # The attempt history table is a fixed name in the application's configuration.
  attempts_table = "${var.name_prefix}-delivery-attempts"
}
