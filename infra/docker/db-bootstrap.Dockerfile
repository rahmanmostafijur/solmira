# syntax=docker/dockerfile:1.7
# The one-off task that creates the databases and roles on RDS (infra/aws/db-bootstrap/bootstrap.sh).
#   docker build -f infra/docker/db-bootstrap.Dockerfile -t db-bootstrap .
FROM postgres:18-alpine

# The RDS certificate authorities, so the connection can verify the server (PGSSLMODE=verify-full).
# The checksum pins the file: when AWS publishes a new bundle the build fails until it is updated
# deliberately (docs/operations/certificate-bundle.md).
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /certs/rds-global-bundle.pem

COPY infra/aws/db-bootstrap/bootstrap.sh /usr/local/bin/bootstrap.sh
USER postgres
ENTRYPOINT ["/usr/local/bin/bootstrap.sh"]
