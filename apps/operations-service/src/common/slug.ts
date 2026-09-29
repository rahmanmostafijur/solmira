import { randomBytes } from 'node:crypto';

/** "Classic Running Shoe (Men's)" → "classic-running-shoe-men-s". Never empty. */
export function slugify(name: string, maxLength = 70): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return base || 'item';
}

/** Used only when the plain slug is already taken in the organization. */
export function withRandomSuffix(slug: string): string {
  return `${slug.slice(0, 70)}-${randomBytes(3).toString('hex')}`;
}
