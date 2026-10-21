import type { AttemptView } from '@solmira/contracts';
import { Badge } from '@/components/ui/badge';
import { describeAttempt } from './delivery-status';

/** Every attempt of one delivery, oldest first, with what the receiver answered. */
export function AttemptTimeline({ attempts }: { attempts: readonly AttemptView[] }) {
  if (attempts.length === 0) {
    return <p className="text-sm text-ink-muted">No attempts recorded yet.</p>;
  }
  return (
    <ol aria-label="Attempts" className="space-y-3">
      {attempts.map((attempt) => {
        const ok = attempt.errorClass === null;
        return (
          <li key={attempt.attempt} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Attempt {attempt.attempt}</span>
              <Badge tone={ok ? 'success' : 'danger'}>
                {describeAttempt(attempt.statusCode, attempt.errorClass)}
              </Badge>
              <span className="text-ink-muted">
                {new Date(attempt.startedAt).toLocaleString()} · {attempt.durationMs} ms
              </span>
            </div>
            {attempt.nextAttemptAt && (
              <p className="mt-1 text-xs text-ink-muted">
                Next attempt {new Date(attempt.nextAttemptAt).toLocaleString()}
              </p>
            )}
            {attempt.responseBody && (
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-canvas p-2 font-mono text-xs whitespace-pre-wrap">
                {attempt.responseBody}
                {attempt.responseBodyTruncated && '\n… (truncated)'}
              </pre>
            )}
          </li>
        );
      })}
    </ol>
  );
}
