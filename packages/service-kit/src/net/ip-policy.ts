import { BlockList, isIP } from 'node:net';

/**
 * Which IP addresses outbound webhook traffic may reach (ADR-0028). IPv4 is a deny list of every
 * special-purpose range; IPv6 is an allow list (global unicast 2000::/3) minus the assignments
 * inside it that are not globally routable. Anything else, including IPv4-mapped (::ffff:0:0/96),
 * NAT64 and unique-local addresses, is rejected outright rather than unwrapped, so an embedded
 * IPv4 address can never smuggle a private target past the check.
 */

const IPV4_DENIED: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including the cloud metadata address 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // deprecated 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including the broadcast address
];

const IPV6_DENIED_INSIDE_GLOBAL: readonly (readonly [string, number])[] = [
  ['2001::', 23], // IETF protocol assignments, including Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4, which embeds an arbitrary IPv4 address
  ['3fff::', 20], // documentation
];

function blockListOf(
  ranges: readonly (readonly [string, number])[],
  family: 'ipv4' | 'ipv6',
): BlockList {
  const list = new BlockList();
  for (const [network, prefix] of ranges) list.addSubnet(network, prefix, family);
  return list;
}

const ipv4Denied = blockListOf(IPV4_DENIED, 'ipv4');
const ipv6GlobalUnicast = blockListOf([['2000::', 3]], 'ipv6');
const ipv6Denied = blockListOf(IPV6_DENIED_INSIDE_GLOBAL, 'ipv6');

/** True only for a literal address that is globally routable and safe to call. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !ipv4Denied.check(address, 'ipv4');
  if (family === 6)
    return ipv6GlobalUnicast.check(address, 'ipv6') && !ipv6Denied.check(address, 'ipv6');
  return false;
}
