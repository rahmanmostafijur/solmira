/**
 * Prices travel as integer minor units (cents) so no floating-point value ever reaches the API.
 * These helpers convert at the edge of the UI, using each currency's own number of decimals.
 */

export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function formatMoney(minor: number, currency: string, locale?: string): string {
  const digits = minorDigits(currency);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
      minor / 10 ** digits,
    );
  } catch {
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
  }
}

/** "12.5" in USD -> 1250. Returns null for anything that is not a valid non-negative amount. */
export function toMinorUnits(input: string, currency: string): number | null {
  const value = input.trim();
  const digits = minorDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);
  if (!pattern.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 1250 in USD -> "12.50", for pre-filling an input. */
export function fromMinorUnits(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}
