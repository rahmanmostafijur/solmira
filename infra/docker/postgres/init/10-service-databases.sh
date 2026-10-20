#!/bin/sh
# Runs once, on first start of an empty data volume.
#
# Each service gets its own database and two roles:
#   <service>_owner  owns the schema and runs migrations (DDL). Never used by the running service.
#   <service>_app    the runtime role: DML only. Because it does not own the tables, PostgreSQL
#                    Row Level Security policies apply to it (table owners bypass RLS by default).
#
# Development only: every role shares SERVICE_DB_PASSWORD. Deployed environments create
# per-role credentials held in AWS Secrets Manager.
set -eu

: "${SERVICE_DB_PASSWORD:?SERVICE_DB_PASSWORD must be set}"

for service in identity ingest notification analytics audit; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v db="solmira_${service}" \
    -v owner="${service}_owner" \
    -v app="${service}_app" \
    -v pwd="$SERVICE_DB_PASSWORD" <<'SQL'
CREATE ROLE :"owner" LOGIN PASSWORD :'pwd';
CREATE ROLE :"app" LOGIN PASSWORD :'pwd';
CREATE DATABASE :"db" OWNER :"owner";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"app";

\connect :"db"
ALTER SCHEMA public OWNER TO :"owner";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
-- Tables and sequences created later by migrations are automatically usable by the runtime role.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app";
SQL
  echo "Provisioned database solmira_${service}"
done
