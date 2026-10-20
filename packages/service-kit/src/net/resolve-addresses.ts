import { lookup } from 'node:dns/promises';

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Every address a host name resolves to (IPv4 and IPv6). The result is capped and the lookup is
 * time-boxed, so a slow or hostile resolver cannot hold a request open.
 */
export async function resolveAddresses(
  hostname: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<readonly string[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs);
  });
  try {
    const results = await Promise.race([lookup(hostname, { all: true, verbatim: true }), timeout]);
    return results.slice(0, 16).map((result) => result.address);
  } finally {
    clearTimeout(timer);
  }
}
