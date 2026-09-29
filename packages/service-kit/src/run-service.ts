import { ConfigValidationError } from './config/load-config.js';

/**
 * Entry-point wrapper for `main.ts`. A startup failure (most often a bad environment) exits with
 * code 1 and a readable message, so the orchestrator marks the deployment failed immediately.
 */
export async function runService(start: () => Promise<unknown>): Promise<void> {
  try {
    await start();
  } catch (error) {
    const message =
      error instanceof ConfigValidationError
        ? error.message
        : `Service failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
