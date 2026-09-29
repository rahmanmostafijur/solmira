'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { z } from 'zod';

type Params = Record<string, string | number | undefined>;

/**
 * Reads list state (page, sort, filters) from the URL with the same zod schema the API uses.
 * An invalid or tampered URL falls back to the defaults instead of sending a request the API
 * would reject.
 */
export function parseListParams<T extends Params>(
  schema: z.ZodType<T>,
  search: URLSearchParams,
): T {
  const raw = Object.fromEntries(search.entries());
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : schema.parse({});
}

/** Only values that differ from the defaults are written, so URLs stay short and shareable. */
export function toSearchString<T extends Params>(values: T, defaults: T): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '' || value === defaults[key]) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Query string for an API call: every defined value, in a stable order. */
export function toApiQuery(values: Params): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(values).sort()) {
    const value = values[key];
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export function useListParams<T extends Params>(schema: z.ZodType<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const defaults = useMemo(() => schema.parse({}), [schema]);
  const params = useMemo(
    () => parseListParams(schema, new URLSearchParams(search.toString())),
    [schema, search],
  );

  /** Any change other than the page itself returns to page 1. */
  const update = useCallback(
    (patch: Partial<T>) => {
      const next: Params = { ...params, ...patch };
      if (!('page' in patch)) next.page = 1;
      router.replace(`${pathname}${toSearchString(next, defaults)}`, { scroll: false });
    },
    [params, defaults, pathname, router],
  );

  const reset = useCallback(() => router.replace(pathname, { scroll: false }), [pathname, router]);

  return { params, update, reset, defaults };
}
