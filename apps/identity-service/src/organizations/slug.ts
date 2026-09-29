import { randomBytes } from 'node:crypto';

const MAX_BASE_LENGTH = 40;

/** "Nordic Pâtisserie & Co." → "nordic-patisserie-co". Never empty. */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '');
  return base || 'organization';
}

/** Used only when the plain slug is already taken. */
export function withRandomSuffix(slug: string): string {
  return `${slug}-${randomBytes(3).toString('hex')}`;
}
