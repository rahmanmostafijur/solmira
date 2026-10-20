import { describe, expect, it } from 'vitest';
import { EndpointUrlError, assertSafeEndpointUrl, checkEndpointUrl } from './endpoint-url.js';

const production = { production: true, allowPrivateTargets: false };
const development = { production: false, allowPrivateTargets: false };
const permissive = { production: false, allowPrivateTargets: true };

const rejectsAll = (urls: string[], options: typeof production, message: string) => {
  for (const url of urls) expect(() => checkEndpointUrl(url, options), url).toThrow(message);
};

describe('checkEndpointUrl', () => {
  it('accepts public https URLs, with ports, paths and queries', () => {
    for (const url of [
      'https://example.com/webhooks',
      'https://hooks.example.co.uk:8443/a/b?token=abc',
      'https://8.8.8.8/hook',
      'https://[2606:4700:4700::1111]/hook',
      'https://example.com./hook',
    ])
      expect(() => checkEndpointUrl(url, production), url).not.toThrow();
  });

  it('requires https in production but allows http elsewhere', () => {
    expect(() => checkEndpointUrl('http://example.com/hook', production)).toThrow('https');
    expect(() => checkEndpointUrl('http://example.com/hook', development)).not.toThrow();
    for (const url of ['ftp://example.com', 'file:///etc/passwd', 'gopher://example.com'])
      expect(() => checkEndpointUrl(url, development), url).toThrow(EndpointUrlError);
    expect(() => checkEndpointUrl('javascript:alert(1)', development)).toThrow(EndpointUrlError);
  });

  it('rejects credentials, fragments and malformed URLs', () => {
    for (const url of [
      'https://user:pass@example.com/',
      'https://user@example.com/',
      'https://example.com/#frag',
      'not a url',
      '',
      '//example.com',
      'https://',
      'https://exa mple.com',
    ])
      expect(() => checkEndpointUrl(url, production), url).toThrow(EndpointUrlError);
  });

  it('rejects literal private, loopback, link-local and metadata addresses', () => {
    rejectsAll(
      [
        'https://127.0.0.1/',
        'https://10.0.0.5/',
        'https://192.168.0.1/',
        'https://172.16.5.5/',
        'https://169.254.169.254/latest/meta-data/',
        'https://100.64.0.1/',
        'https://0.0.0.0/',
        'https://224.0.0.1/',
        'https://255.255.255.255/',
        'https://[::1]/',
        'https://[fd00::1]/',
        'https://[fe80::1]/',
        'https://[::ffff:127.0.0.1]/',
        'https://[::ffff:a9fe:a9fe]/',
        'https://[64:ff9b::7f00:1]/',
        'https://[2002:7f00:1::]/',
      ],
      production,
      'non-public',
    );
  });

  it('sees through alternative spellings of IPv4 addresses', () => {
    rejectsAll(
      [
        'https://2130706433/',
        'https://0x7f000001/',
        'https://0x7f.0.0.1/',
        'https://017700000001/',
        'https://0177.0.0.1/',
        'https://127.1/',
        'https://127.0.1/',
        'https://2852039166/',
        'https://0xa9fea9fe/',
      ],
      production,
      'non-public',
    );
  });

  it('rejects local-only host names', () => {
    rejectsAll(
      [
        'https://localhost/',
        'https://LOCALHOST/',
        'https://app.localhost/',
        'https://printer.local/',
        'https://metadata.google.internal/',
        'https://db.internal/',
        'https://intranet/',
        'https://router.lan/',
        'https://x.home.arpa/',
        'https://corp.localdomain/',
        'https://localhost./',
      ],
      production,
      'public host name',
    );
  });

  it('only relaxes the address rules in the explicit development mode', () => {
    for (const url of ['http://127.0.0.1:9000/hook', 'http://localhost:3000/', 'https://10.0.0.1/'])
      expect(() => checkEndpointUrl(url, permissive), url).not.toThrow();
    expect(() => checkEndpointUrl('https://user:pw@127.0.0.1/', permissive)).toThrow('username');
    expect(() => checkEndpointUrl('ftp://127.0.0.1/', permissive)).toThrow('https');
  });
});

describe('assertSafeEndpointUrl', () => {
  const resolvingTo = (...addresses: string[]) => ({
    ...production,
    resolve: async () => addresses,
  });

  it('accepts a host that resolves only to public addresses', async () => {
    const options = resolvingTo('93.184.216.34', '2606:2800:220:1::1');
    await expect(assertSafeEndpointUrl('https://example.com/h', options)).resolves.toBeInstanceOf(
      URL,
    );
  });

  it('rejects a host that resolves to any non-public address', async () => {
    for (const addresses of [
      ['10.0.0.1'],
      ['93.184.216.34', '127.0.0.1'],
      ['::1'],
      ['169.254.169.254'],
    ])
      await expect(
        assertSafeEndpointUrl('https://rebind.example.com/h', resolvingTo(...addresses)),
        addresses.join(),
      ).rejects.toThrow('non-public');
  });

  it('does not reveal which address a host resolved to', async () => {
    const failure = await assertSafeEndpointUrl(
      'https://x.example.com/',
      resolvingTo('10.1.2.3'),
    ).catch((error: Error) => error);
    expect((failure as Error).message).not.toContain('10.1.2.3');
  });

  it('rejects hosts that do not resolve or whose lookup fails', async () => {
    await expect(assertSafeEndpointUrl('https://nx.example.com/', resolvingTo())).rejects.toThrow(
      'could not be resolved',
    );
    const failing = {
      ...production,
      resolve: async (): Promise<string[]> => {
        throw new Error('ENOTFOUND');
      },
    };
    await expect(assertSafeEndpointUrl('https://nx.example.com/', failing)).rejects.toThrow(
      'could not be resolved',
    );
  });

  it('does not resolve literal addresses or in development mode', async () => {
    const resolve = async (): Promise<string[]> => {
      throw new Error('must not be called');
    };
    await expect(
      assertSafeEndpointUrl('https://8.8.8.8/', { ...production, resolve }),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertSafeEndpointUrl('http://localhost:1/', { ...permissive, resolve }),
    ).resolves.toBeInstanceOf(URL);
  });
});
