/** Parses text the user typed as a JSON object, with a message fit for a form field. */
export function parseJsonObject(
  text: string,
): { value: Record<string, unknown> } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `Not valid JSON: ${error instanceof Error ? error.message : 'parse error'}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    return { error: 'Enter a JSON object, for example {"type": "object"}' };
  return { value: parsed as Record<string, unknown> };
}

export const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2);
