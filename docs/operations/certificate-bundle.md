# Certificate bundle

Services connect to RDS with full verification against the AWS RDS CA bundle, which the images contain
(`/app/certs/rds-global-bundle.pem`, referenced by `NODE_EXTRA_CA_CERTS`; the bootstrap image keeps it at
`/certs/rds-global-bundle.pem` for `PGSSLROOTCERT`). The Dockerfiles download it with a pinned sha256
checksum, so a changed or tampered download fails the build instead of shipping.

## When the build fails on the checksum

AWS republishes the bundle when it adds or retires certificate authorities. That is expected a few times a
year; it is not an attack until you have checked.

1. Download it yourself from `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`.
2. Inspect the certificates
   (`openssl crl2pkcs7 -nocrl -certfile global-bundle.pem | openssl pkcs7 -print_certs -noout`): all should
   be issued to Amazon RDS certificate authorities, and the AWS documentation for RDS SSL certificates
   should describe the same set.
3. Compute `sha256sum global-bundle.pem` and replace the checksum in `infra/docker/service.Dockerfile`
   and `infra/docker/db-bootstrap.Dockerfile`.
4. Rebuild and release as usual ([Deploying a change](deploy.md)).

## When the database certificate is rotated

If AWS rotates the instance certificate to one that the bundle in the running images does not cover,
connections fail with a certificate error. Build and release images with the current bundle first, then
apply the certificate change on the instance.
