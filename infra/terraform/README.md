# Terraform

The AWS infrastructure for Solmira ([ADR-0038](../../docs/adr/0038-aws-deployment.md)). It is **written,
validated and planned offline, and has never been applied.** Nothing is applied without the owner's
approval of a plan, and applying creates resources that cost money.

## Layout

| File                                               | Contents                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `network.tf`, `endpoints.tf`, `security_groups.tf` | VPC, subnets, NAT, VPC endpoints, security groups                                |
| `alb.tf`, `waf.tf`, `dns.tf`                       | Load balancer and path routes, firewall rules, certificate and DNS               |
| `ecs.tf`, `modules/service`, `scaling.tf`          | Cluster, one service per application, dispatcher scaling                         |
| `data_*.tf`                                        | RDS PostgreSQL, ElastiCache, Amazon MQ, DynamoDB                                 |
| `kms.tf`, `iam.tf`, `secrets.tf`                   | Keys, per-service task roles, Secrets Manager                                    |
| `oneoff_tasks.tf`                                  | Database bootstrap, migrations and dead-letter tool as ECS tasks                 |
| `observability.tf`, `alarms*.tf`, `dashboard.tf`   | Log groups, alarms, dashboard ([ADR-0039](../../docs/adr/0039-observability.md)) |
| `variables.tf`, `terraform.tfvars.example`         | Every setting, with descriptions and defaults                                    |

## Checking a change without AWS

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
./offline-plan.sh          # plans with placeholder credentials and a local state; creates nothing
```

CI runs the same. An offline plan proves the configuration is coherent; it does not prove AWS will accept
it (quotas, regional availability and some argument checks happen only on apply).

## Applying (owner only)

Follow [the first-deployment runbook](../../docs/operations/first-deploy.md): configure the state backend
(`backend.hcl`, an encrypted, versioned S3 bucket), apply in stages, read every plan before applying.

- **State holds secrets.** Generated passwords (database, broker, cache) are in the Terraform state. Keep
  the state bucket private, encrypted and versioned, and limit who can read it.
- **Images come first.** Image tags are immutable; `image_tag` must name images already pushed.
- **`start_services=false`** creates everything with no tasks running, for first deployment and for
  restores.
- **Deletion protection** is on for the database and the history table; destroying the environment takes
  deliberate steps.
