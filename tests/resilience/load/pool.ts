import { sendMessage, type Sent } from '../src/tenant.js';
import { sleep } from '../src/wait.js';

export interface Target {
  readonly baseUrl: string;
  readonly applicationId: string;
  readonly apiKeys: readonly string[];
  readonly eventType: string;
}

const sendOne = (target: Target, index: number): Promise<Sent> =>
  sendMessage(
    target.baseUrl,
    target.applicationId,
    target.apiKeys[index % target.apiKeys.length]!,
    target.eventType,
    { seq: index, filler: 'x'.repeat(200) },
  );

/** Closed loop: `concurrency` requests in flight, each followed by the next, until `total` are sent. */
export async function sendClosedLoop(
  target: Target,
  total: number,
  concurrency: number,
): Promise<Sent[]> {
  const results: Sent[] = new Array<Sent>(total);
  let next = 0;
  const worker = async () => {
    while (next < total) {
      const index = next++;
      results[index] = await sendOne(target, index);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/** Open loop: a request starts every 1/rate seconds whether or not the previous ones finished. */
export async function sendAtRate(
  target: Target,
  ratePerSecond: number,
  seconds: number,
): Promise<Sent[]> {
  const total = Math.round(ratePerSecond * seconds);
  const started = performance.now();
  const pending: Promise<Sent>[] = [];
  for (let index = 0; index < total; index += 1) {
    const due = started + (index * 1000) / ratePerSecond;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    pending.push(sendOne(target, index));
  }
  return Promise.all(pending);
}
