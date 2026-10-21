'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from './button';

/** Shows a secret that will not be shown again, with a copy button. */
export function SecretDisplay({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code
          data-testid="secret-value"
          className="block min-w-0 flex-1 break-all rounded-md border border-line bg-canvas px-3 py-2 font-mono text-xs"
        >
          {value}
        </code>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
