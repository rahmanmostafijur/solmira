import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './ip-policy.js';

const allPublic = (addresses: string[], expected: boolean) => {
  for (const address of addresses) expect(isPublicAddress(address), address).toBe(expected);
};

describe('isPublicAddress', () => {
  it('accepts globally routable IPv4 and IPv6 addresses', () => {
    allPublic(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'], true);
    allPublic(['2a00:1450:4001:81b::200e'], true);
  });

  it('rejects private, loopback, link-local and metadata IPv4 addresses', () => {
    allPublic(
      [
        '0.0.0.0',
        '10.0.0.1',
        '10.255.255.255',
        '100.64.0.1',
        '127.0.0.1',
        '127.255.255.254',
        '169.254.169.254',
        '169.254.0.1',
        '172.16.0.1',
        '172.31.255.255',
        '192.0.0.1',
        '192.0.2.1',
        '192.168.1.1',
        '198.18.0.1',
        '198.51.100.7',
        '203.0.113.9',
        '224.0.0.1',
        '239.255.255.250',
        '240.0.0.1',
        '255.255.255.255',
      ],
      false,
    );
  });

  it('keeps the public neighbours of denied IPv4 ranges reachable', () => {
    allPublic(
      [
        '9.255.255.255',
        '11.0.0.1',
        '172.15.255.255',
        '172.32.0.1',
        '192.167.255.255',
        '169.253.255.255',
        '100.63.255.255',
        '100.128.0.1',
      ],
      true,
    );
  });

  it('rejects loopback, unique-local, link-local, multicast and unspecified IPv6', () => {
    allPublic(
      ['::', '::1', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'fec0::1', 'ff02::1'],
      false,
    );
  });

  it('rejects IPv4-mapped, NAT64 and 6to4 forms instead of unwrapping them', () => {
    allPublic(
      [
        '::ffff:127.0.0.1',
        '::ffff:169.254.169.254',
        '::ffff:7f00:1',
        '::ffff:8.8.8.8',
        '64:ff9b::7f00:1',
        '2002:7f00:1::1',
        '2002:a9fe:a9fe::1',
      ],
      false,
    );
  });

  it('rejects documentation and protocol-assignment IPv6 ranges', () => {
    allPublic(['2001:db8::1', '2001::1', '2001:1::1', '3fff::1'], false);
  });

  it('rejects anything that is not a literal address', () => {
    allPublic(
      ['', 'example.com', '127.1', '0x7f.1', '2130706433', 'fe80::1%eth0', '[::1]', '1.2.3.4.5'],
      false,
    );
  });
});
