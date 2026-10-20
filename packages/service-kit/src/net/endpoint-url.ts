import { isIP } from 'node:net';
import { MAX_ENDPOINT_URL_LENGTH } from '@solmira/contracts';
import { isPublicAddress } from './ip-policy.js';

/** A rejected endpoint URL. The message is safe to show to the tenant. */
export class EndpointUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EndpointUrlError';
  }
}

export interface EndpointUrlOptions {
  /** Production requires https. */
  readonly production: boolean;
  /**
   * Development and test only: allows http and addresses that are not public, so local receivers
   * work. The service configuration refuses this in production.
   */
  readonly allowPrivateTargets: boolean;
}

export type AddressResolver = (hostname: string) => Promise<readonly string[]>;

const FORBIDDEN_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.lan',
  '.home.arpa',
];

function reject(message: string): never {
  throw new EndpointUrlError(message);
}

/** The IP literal inside a URL host: `[::1]` becomes `::1`. */
function literalAddress(hostname: string): string | undefined {
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return isIP(bare) ? bare : undefined;
}

/**
 * Everything that can be decided from the text of the URL alone. Decimal, octal and hexadecimal
 * IPv4 spellings are normalized by the WHATWG URL parser before the host is inspected.
 */
export function checkEndpointUrl(raw: string, options: EndpointUrlOptions): URL {
  if (raw.length > MAX_ENDPOINT_URL_LENGTH) reject('The URL is too long');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject('Enter a valid URL, for example https://example.com/webhooks');
  }

  const permissive = options.allowPrivateTargets;
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && (permissive || !options.production))
  )
    reject('The URL must use https');
  if (url.username || url.password) reject('The URL cannot contain a username or password');
  if (url.hash) reject('The URL cannot contain a fragment');

  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!hostname) reject('The URL needs a host');
  if (permissive) return url;

  const address = literalAddress(hostname);
  if (address !== undefined) {
    if (!isPublicAddress(address)) reject('The URL points to a non-public address');
    return url;
  }
  if (
    !hostname.includes('.') ||
    FORBIDDEN_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  )
    reject('The URL must use a public host name');
  return url;
}

/**
 * The creation-time check: the static rules plus a lookup of the host. Advisory only, because DNS
 * can change; the dispatcher resolves again and pins the address at send time.
 */
export async function assertSafeEndpointUrl(
  raw: string,
  options: EndpointUrlOptions & { readonly resolve: AddressResolver },
): Promise<URL> {
  const url = checkEndpointUrl(raw, options);
  if (options.allowPrivateTargets) return url;

  const hostname = url.hostname.replace(/\.$/, '');
  if (literalAddress(hostname) !== undefined) return url;

  let addresses: readonly string[];
  try {
    addresses = await options.resolve(hostname);
  } catch {
    return reject('The host name could not be resolved');
  }
  if (addresses.length === 0) reject('The host name could not be resolved');
  if (!addresses.every(isPublicAddress)) reject('The host name resolves to a non-public address');
  return url;
}
