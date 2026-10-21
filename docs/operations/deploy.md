# Deploying a change, and rolling back

Not yet run on AWS. Every release is an image tag; the tag is the only thing that changes.

## Release

1. CI is green on the commit (lint, types, unit and integration tests, image builds).
2. Build and push the images with the commit's short sha as the tag
   ([First deployment, step 2](first-deploy.md#2-create-the-repositories-and-push-the-images)).
3. **Migrate before the new code runs.** If the release has migrations for a service, run that service's
   `migrate` task from the new image first ([Running a one-off task](README.md#running-a-one-off-task)),
   in the order identity, ingest, notification, analytics, audit. A migration must leave the previous
   release working (add, backfill, then switch; never rename or drop in the same release): review each
   migration against that rule before approving the release, because nothing enforces it automatically.
4. `terraform plan -var-file=production.tfvars -var image_tag=<tag>`. The plan should differ from the
   running state by the task definitions and nothing else. The owner approves; then `apply`.
5. ECS replaces tasks gradually behind the load balancer. A task that does not become healthy stops the
   rollout and the deployment circuit breaker rolls the service back by itself.
6. Watch the dashboard for ten minutes: 5xx rate, response time, `OldestDueAge`, dead-letter counts.

## Rolling back

Apply again with the previous tag: `terraform apply -var-file=production.tfvars -var image_tag=<previous>`.

Migrations are forward-only. Rolling the code back does not undo them, which is why they must be
compatible with the release before. If a migration itself is the problem, fix it forward with a new
migration; restoring the database is the last resort ([Restore](restore.md)).

## What can go wrong

- **A release that adds a required setting.** The service refuses to start and names the setting in its
  log; add it to the service's secret or environment in Terraform and apply.
- **A migration that takes a long lock.** Run it in a quiet period and watch CPU and connections on the
  database; the migration tasks have no timeout of their own.
- **The dispatcher during a rollout.** Delivery is at least once and claims expire, so replacing
  dispatcher tasks at any moment loses nothing; a delivery in flight may be sent again, which receivers
  must tolerate by deduplicating on `webhook-id`.
