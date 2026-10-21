# Operations

Runbooks for running Solmira on AWS (infrastructure in [`infra/terraform`](../../infra/terraform/README.md),
decisions in [ADR-0038](../adr/0038-aws-deployment.md) and [ADR-0039](../adr/0039-observability.md)).
Each one says what you see, what it means for customers, what to check, what to do, and how to know it
worked.

**Status of these procedures.** They were written from the code and the configuration and checked against
the local stack where that is possible (the database bootstrap against a real PostgreSQL, the dead-letter
tool against a real broker, the chaos scenarios for broker and worker failure). **None has been run on
AWS**, because nothing has been applied there. Treat each as a draft until it has been exercised once in a
non-production account, and record that here.

| Runbook                                           | When                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| [First deployment](first-deploy.md)               | Creating an environment from nothing                                |
| [Deploying a change, and rolling back](deploy.md) | Every release                                                       |
| [Delivery backlog](delivery-backlog.md)           | Alarm: deliveries are waiting too long                              |
| [Dead-letter queues](dead-letter-queues.md)       | Alarm: events no consumer could process                             |
| [RabbitMQ failure](rabbitmq-failure.md)           | Alarm: outbox lag or broker trouble; the broker is down or replaced |
| [Key and credential rotation](key-rotation.md)    | Scheduled, or after a suspected leak                                |
| [Restore](restore.md)                             | Data lost or damaged                                                |
| [Certificate bundle](certificate-bundle.md)       | The image build fails on the RDS certificate checksum               |

## What to look at first

The dashboard (`terraform output dashboard`) is ordered by the questions an operator asks: are customers
served (requests, errors, response time), are deliveries moving (backlog and its age, attempts by result,
outbox, dead letters), is the platform healthy (containers, database, cache, broker, table, firewall).

The alarm that matters most is **the age of the oldest due delivery** (`OldestDueAge`): it rises when
anything between an event arriving and a request leaving is stuck, whatever the cause.

## Running a one-off task

The database bootstrap, the migrations and the dead-letter tool run as one-off ECS tasks. The cluster,
subnets, security group and task families come from the Terraform outputs `cluster`,
`subnets_for_oneoff_tasks` and `oneoff_task_definitions`.

```bash
aws ecs run-task --cluster <cluster> --launch-type FARGATE \
  --task-definition <family> \
  --network-configuration 'awsvpcConfiguration={subnets=[<subnet>,<subnet>],securityGroups=[<group>],assignPublicIp=DISABLED}' \
  --overrides '{"containerOverrides":[{"name":"<container>","command":["..."]}]}'
```

The container is named `bootstrap`, `migrate` or `dead-letters`. Output is in the log group
`/solmira/<environment>/oneoff`. There is no shell access to production containers (ECS Exec is off) and
no standing network path to the database or the broker: that is deliberate, and these tasks are how work
is done inside the network.
