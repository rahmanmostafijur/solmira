/**
 * Custom headers are edited as text, one `name: value` per line, and sent as an object. Names are
 * lowercased because the API stores them that way; the server still validates every rule.
 */
export function parseHeadersText(text: string): {
  headers: Record<string, string>;
  error?: string;
} {
  const headers: Record<string, string> = {};
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon <= 0) return { headers, error: `Line ${index + 1}: use the form "name: value"` };
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name in headers) return { headers, error: `Line ${index + 1}: "${name}" appears twice` };
    headers[name] = value;
  }
  return { headers };
}

export function formatHeadersText(headers: Readonly<Record<string, string>>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}
