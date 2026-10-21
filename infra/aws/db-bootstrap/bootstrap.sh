#!/bin/sh
# Creates the databases and roles of every service on the RDS instance (one-off ECS task,
# docs/operations/first-deploy.md). Safe to run again: it creates what is missing and sets every
# role's password to the value in Secrets Manager, which is also how a password is rotated.
#
# Each service gets its own database and two roles (ADR-0012):
#   <service>_owner  owns the schema and runs migrations. Never used by the running service.
#   <service>_app    the runtime role: DML only. It does not own the tables, so Row Level Security applies.
# The dispatcher has its own role on the ingest database (ADR-0031); ingest's migration grants it access.
#
# Connection: the standard PG* variables (host, user, password, SSL). Role passwords come from
# ROLE_PASSWORD_<ROLE> variables, filled from Secrets Manager by the task definition.
set -eu

password_of() {
  value=$(printenv "ROLE_PASSWORD_$(printf '%s' "$1" | tr 'a-z' 'A-Z')" || true)
  [ -n "$value" ] || { echo "No password given for role $1" >&2; exit 1; }
  printf '%s' "$value"
}

for service in identity ingest notification analytics audit; do
  owner="${service}_owner"
  app="${service}_app"
  database="solmira_${service}"
  owner_password=$(password_of "$owner")
  app_password=$(password_of "$app")

  # Roles and the database. The administrative user is made a member of the owner so it may create the
  # database for it; RDS administrators are not superusers.
  psql -v ON_ERROR_STOP=1 -v owner="$owner" -v app="$app" -v db="$database" \
    -v owner_password="$owner_password" -v app_password="$app_password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'owner') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app') \gexec
ALTER ROLE :"owner" PASSWORD :'owner_password';
ALTER ROLE :"app" PASSWORD :'app_password';
GRANT :"owner" TO CURRENT_USER;
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"app";
SQL

  # Inside the database: schema ownership and the default privileges that make later migrations
  # usable by the runtime role.
  psql -v ON_ERROR_STOP=1 -v owner="$owner" -v app="$app" -d "$database" <<'SQL'
ALTER SCHEMA public OWNER TO :"owner";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO :"app";
SQL
  echo "Provisioned ${database}"
done

dispatcher_password=$(password_of dispatcher_app)
psql -v ON_ERROR_STOP=1 -v dispatcher_password="$dispatcher_password" <<'SQL'
SELECT 'CREATE ROLE dispatcher_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dispatcher_app') \gexec
ALTER ROLE dispatcher_app PASSWORD :'dispatcher_password';
GRANT CONNECT, TEMPORARY ON DATABASE solmira_ingest TO dispatcher_app;
SQL
echo "Provisioned dispatcher_app"
