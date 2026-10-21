# Restore

**Not exercised.** Neither procedure has been run on AWS, and no restore has been timed, so no recovery
time or recovery point is claimed here beyond what AWS documents for the services.

## What is protected

| Data                                 | Protection (from Terraform)                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL (all five databases)      | Automated backups with point-in-time recovery; deletion protection; a final snapshot is taken if the instance is ever deleted    |
| DynamoDB `delivery-attempts` history | Point-in-time recovery; deletion protection; entries expire on their own (TTL)                                                   |
| Redis, RabbitMQ                      | Not backed up: Redis holds rate-limit and cache state, RabbitMQ holds in-flight events ([RabbitMQ failure](rabbitmq-failure.md)) |
| KMS keys                             | 30-day deletion window; never delete the signing-secrets key while secrets depend on it                                          |

## PostgreSQL

1. Decide the time to restore to (just before the damage). Restoring creates a **new** instance; it never
   overwrites the running one.
2. `aws rds restore-db-instance-to-point-in-time` from the source instance, with the same subnet group,
   parameter group (it carries `rds.force_ssl`) and security group.
3. Stop the services (`terraform apply -var start_services=false`) so nothing writes to the old or new
   instance meanwhile.
4. Check the restored data (row counts, the latest messages) from a one-off task.
5. Point Terraform at the new instance (rename or import it), or copy back only what is damaged with
   `pg_dump`/`psql` from a one-off task. Roles, grants and row-level security policies are part of the
   restored data; re-run the `bootstrap` task if passwords must be set again.
6. Start the services. Deliveries that were due during the outage are sent late; events lost with the
   broker are described in [RabbitMQ failure](rabbitmq-failure.md).

Restoring loses what was written after the chosen time. A delivery whose success fell after that time is
sent again, which receivers must tolerate by deduplicating on `webhook-id`.

## DynamoDB history

`aws dynamodb restore-table-to-point-in-time` creates a new table; point the services at it
(`DYNAMODB_TABLE`) or copy the items back. History is a record of attempts, not the source of truth for
delivery state, so losing part of it does not stop deliveries.

## Test it

Before relying on this: in a non-production account, restore the database to a point in time, run the
integration checks against it, record how long it took, and update this page.
