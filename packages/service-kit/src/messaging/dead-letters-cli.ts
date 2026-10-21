/**
 * Operator tool for the dead-letter queues (docs/operations/dead-letter-queues.md). It runs as a
 * one-off task from any service image, with the broker address in RABBITMQ_URL:
 *
 *   node node_modules/@solmira/service-kit/dist/messaging/dead-letters-cli.js peek ingest.fan-out
 *   node ... requeue ingest.fan-out --limit 50
 *   node ... discard ingest.fan-out <eventId> [<eventId> ...]
 *
 * `peek` lists envelope identities, never bodies, and changes nothing. `requeue` moves messages back
 * to the consumer. `discard` removes the messages with the given event ids.
 */
import amqp from 'amqplib';

const DEFAULT_LIMIT = 100;

function usage(): never {
  process.stderr.write(
    'Usage: dead-letters-cli <peek|requeue|discard> <consumer queue> [--limit N] [event ids...]\n',
  );
  process.exit(2);
}

const [command, queue, ...rest] = process.argv.slice(2);
if (!command || !queue || !['peek', 'requeue', 'discard'].includes(command)) usage();

const limitIndex = rest.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(rest[limitIndex + 1]) : DEFAULT_LIMIT;
if (!Number.isInteger(limit) || limit < 1) usage();
const eventIds = new Set(
  rest.filter((argument, index) => index !== limitIndex && index !== limitIndex + 1),
);

const url = process.env.RABBITMQ_URL;
if (!url) {
  process.stderr.write('RABBITMQ_URL is not set\n');
  process.exit(2);
}

const { peekDeadLetters, requeueDeadLetters, discardDeadLetters } =
  await import('./dead-letters.js');
const connection = await amqp.connect(url);
let channel: Awaited<ReturnType<typeof connection.createConfirmChannel>> | undefined;
try {
  channel = await connection.createConfirmChannel();
  if (command === 'peek') {
    for (const summary of await peekDeadLetters(channel, queue, limit)) {
      process.stdout.write(JSON.stringify(summary) + '\n');
    }
  } else if (command === 'requeue') {
    process.stdout.write(`requeued ${await requeueDeadLetters(channel, queue, limit)}\n`);
  } else {
    if (eventIds.size === 0) usage();
    process.stdout.write(
      `discarded ${await discardDeadLetters(channel, queue, eventIds, Math.max(limit, 1_000))}\n`,
    );
  }
} finally {
  // Closing the channel first sends the acknowledgements still queued; closing the connection alone
  // can drop them, and an unacknowledged message goes back to the dead-letter queue.
  await channel?.close().catch(() => undefined);
  await connection.close().catch(() => undefined);
}
