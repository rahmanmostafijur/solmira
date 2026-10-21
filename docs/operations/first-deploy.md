# First deployment

Creating an environment from nothing. Nothing here is applied automatically: **the owner approves the
plan before `terraform apply`**, and every step after it is a person running a command. This has not been
run on AWS.

## Before you start

- An AWS account and a role with administrator rights for the first apply.
- A Route 53 hosted zone for the domain, and a verified sender in Amazon SES with SMTP credentials stored
  as a Secrets Manager secret whose value is the SMTP URL
  (`smtps://user:password@email-smtp.<region>.amazonaws.com:465`).
- An S3 bucket for Terraform state (versioned, encrypted, private). Locking uses the bucket itself
  (`use_lockfile`).
- `terraform` 1.9 or newer, the AWS CLI, Docker, `jq`, `openssl`.

## 1. Configure

```bash
cd infra/terraform
cp terraform.tfvars.example production.tfvars      # fill it in; it holds no secrets
cat > backend.hcl <<'HCL'
bucket       = "<state bucket>"
key          = "solmira/production.tfstate"
region       = "<region>"
encrypt      = true
use_lockfile = true
HCL
terraform init -backend-config=backend.hcl
```

## 2. Create the repositories and push the images

The image repositories must exist before the images can be pushed, and the services need the images.

```bash
export TAG=$(git rev-parse --short HEAD)
terraform apply -var-file=production.tfvars -var image_tag=$TAG -var start_services=false \
  -target=aws_kms_key.data -target=aws_ecr_repository.service
```

Then, from the repository root:

```bash
REGISTRY=<account>.dkr.ecr.<region>.amazonaws.com
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
for pair in identity:identity-service ingest:ingest-service dispatcher:dispatcher \
            notification:notification-service analytics:analytics-service audit:audit-service; do
  repository=${pair%%:*}; service=${pair##*:}
  docker build -f infra/docker/service.Dockerfile --build-arg SERVICE=$service \
    -t $REGISTRY/solmira/$repository:$TAG . && docker push $REGISTRY/solmira/$repository:$TAG
done
docker build -f infra/docker/web.Dockerfile -t $REGISTRY/solmira/web:$TAG . \
  && docker push $REGISTRY/solmira/web:$TAG
docker build -f infra/docker/db-bootstrap.Dockerfile -t $REGISTRY/solmira/db-bootstrap:$TAG . \
  && docker push $REGISTRY/solmira/db-bootstrap:$TAG
```

(`terraform output ecr_repositories` lists the exact repository URLs; the prefix is `name_prefix`.)

## 3. Create everything else, with the services switched off

```bash
terraform plan  -var-file=production.tfvars -var image_tag=$TAG -var start_services=false -out=first.plan
# Read the plan. The owner approves it here.
terraform apply first.plan
```

This creates the network, the data stores, the keys, the secrets, the load balancer and the firewall, and
the services with no tasks, so nothing starts against an empty database.

## 4. Give identity its signing keys

Identity signs access tokens with an Ed25519 key. The private key never goes through Terraform:

```bash
openssl genpkey -algorithm ed25519 -out identity.key
openssl pkey -in identity.key -pubout -out identity.pub
aws secretsmanager put-secret-value --secret-id "$(terraform output -raw identity_signing_keys_secret)" \
  --secret-string "$(jq -n --arg priv "$(cat identity.key)" --arg pub "$(cat identity.pub)" \
     '{JWT_PRIVATE_KEY:$priv, JWT_PUBLIC_KEY:$pub, JWT_KEY_ID:"identity-1"}')"
shred -u identity.key identity.pub 2>/dev/null || rm -f identity.key identity.pub
```

## 5. Create the databases and roles, then migrate

Run the `bootstrap` task once (see [Running a one-off task](README.md#running-a-one-off-task); the
families are in `terraform output oneoff_task_definitions`). Its log ends with `Provisioned
dispatcher_app`. Then run the `migrate` task of each service in this order, because ingest's migration
grants the dispatcher its access to the ingest tables: identity, ingest, notification, analytics, audit.
Each logs `migrations applied`.

## 6. Start the services

```bash
terraform apply -var-file=production.tfvars -var image_tag=$TAG     # start_services defaults to true
```

Watch the deployments reach steady state (`aws ecs describe-services`), then:

- `curl -fsS https://<domain>/healthz` answers (the web application);
- `curl -fsS https://<domain>/api/v1/auth/.well-known/jwks.json` shows the identity key;
- the dashboard shows requests and no unhealthy targets, and `OutboxOldestAge` and `OldestDueAge` are
  near zero.

## 7. First account

Register the first user in the console; they become the owner of their organization. Confirm the alarm
subscription from the email AWS sends to the alarm address.

## If something is wrong

- Tasks stop immediately: read the service's log group (`/solmira/<environment>/<service>`). A missing
  signing key or an unreachable database is reported at start, by name.
- The bootstrap cannot connect: the master credentials are in the secret RDS keeps for the instance; the
  task reads them for you, so check the security group and the task's subnets first.
- The apply cannot create the certificate: the hosted zone id is wrong, or the domain is not in it.
