/** Output of the chaos tests and the load tool: what was measured, for the person running them. */
export function say(...parts: unknown[]): void {
  process.stdout.write(parts.map(String).join(' ') + '\n');
}

export function warn(...parts: unknown[]): void {
  process.stderr.write(parts.map(String).join(' ') + '\n');
}
