'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type {
  PurchaseOrderDetail,
  PurchaseReceiptResult,
  ReceivePurchaseOrderRequest,
} from '@solmira/contracts';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { TextAreaField } from '@/components/ui/field';
import { ApiError } from '@/lib/api/client';
import { useReceivePurchaseOrder } from '@/lib/purchasing-queries';
import {
  receiveFieldFor,
  receiveFormDefaults,
  receiveFormSchema,
  summarizeReceipt,
  toReceiveRequest,
  type ReceiveFormInput,
  type ReceiveFormValues,
} from './form-values';
import { formatUnits } from './labels';
import { applyPurchasingError } from './server-errors';

const TH = 'px-4 py-2.5 font-medium whitespace-nowrap';

/** One key per receiving attempt, so a retried request is recognized as the same receipt. */
const newIdempotencyKey = () => crypto.randomUUID();

/**
 * A refusal the server answered for certain (validation, over-receiving, a status that no longer
 * allows receiving) recorded nothing, so the next attempt gets a fresh key. A network error, a
 * timeout or a server failure may have recorded the receipt: the retry keeps the key so the
 * server replays that receipt instead of receiving twice.
 */
/**
 * A 4xx means the server refused and recorded nothing, so the next attempt gets a new key. 408
 * (timeout) and 429 (rate limited, possibly by a proxy after forwarding) prove nothing: keep the
 * key, so a retry either replays the recorded receipt or records it once.
 */
const refusedForCertain = (error: unknown) =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408 &&
  error.status !== 429;

interface Pending {
  readonly request: ReceivePurchaseOrderRequest;
  readonly values: ReceiveFormValues;
}

export function ReceiveForm({
  organizationId,
  order,
  onReceived,
}: {
  organizationId: string;
  order: PurchaseOrderDetail;
  onReceived: (result: PurchaseReceiptResult) => void;
}) {
  const receive = useReceivePurchaseOrder(organizationId, order.id);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [pending, setPending] = useState<Pending | null>(null);
  /** The attempt whose outcome is unknown; retried exactly as sent, with the same key. */
  const [unconfirmed, setUnconfirmed] = useState<Pending | null>(null);
  const schema = useMemo(() => receiveFormSchema(order.items), [order.items]);
  const form = useForm<ReceiveFormInput, unknown, ReceiveFormValues>({
    resolver: zodResolver(schema),
    defaultValues: receiveFormDefaults(order.items),
  });
  const { errors } = form.formState;
  const linesError = errors.lines?.root?.message ?? errors.lines?.message;
  const outstanding = order.items.filter((item) => item.remainingQuantity > 0);

  const fillRemaining = () =>
    order.items.forEach((item, index) =>
      form.setValue(
        `lines.${index}.quantity`,
        item.remainingQuantity > 0 ? String(item.remainingQuantity) : '',
        { shouldDirty: true, shouldValidate: form.formState.isSubmitted },
      ),
    );

  const clear = () => {
    form.reset(receiveFormDefaults(order.items));
    setIdempotencyKey(newIdempotencyKey());
    setUnconfirmed(null);
  };

  const onSubmit = form.handleSubmit((values) =>
    setPending({ request: toReceiveRequest(values), values }),
  );

  const send = async (attempt: Pending) => {
    const { request, values } = attempt;
    try {
      const result = await receive.mutateAsync({ body: request, idempotencyKey });
      setIdempotencyKey(newIdempotencyKey());
      setUnconfirmed(null);
      onReceived(result);
    } catch (error) {
      if (refusedForCertain(error)) {
        setIdempotencyKey(newIdempotencyKey());
        setUnconfirmed(null);
        applyPurchasingError(error, form.setError, receiveFieldFor(request, values));
      } else {
        setUnconfirmed(attempt);
      }
    } finally {
      setPending(null);
    }
  };

  const summary = pending ? summarizeReceipt(pending.request, order.items) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      {unconfirmed && (
        <Alert tone="warning" title="We could not confirm this receipt">
          The connection failed before the server answered, so the receipt may or may not have been
          recorded. Retry it: the same receipt is sent again, and the server records it at most
          once. Start over only if you want to record something different.
        </Alert>
      )}
      {linesError && <Alert tone="error">{linesError}</Alert>}
      <fieldset disabled={unconfirmed !== null} className="space-y-5">
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table aria-label="Lines to receive" className="w-full text-sm">
            <thead className="bg-canvas text-xs text-ink-muted">
              <tr>
                <th scope="col" className={`${TH} text-left`}>
                  Item
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Ordered
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Received
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Remaining
                </th>
                <th scope="col" className={`${TH} w-44 text-left`}>
                  Receive now
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.items.map((item, index) => {
                const error = errors.lines?.[index]?.quantity?.message;
                const done = item.remainingQuantity === 0;
                return (
                  <tr key={item.id} className={clsx(done && 'text-ink-muted')}>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs font-medium">{item.sku}</span>
                      <p>
                        {item.productName}
                        {item.variantName !== item.productName && (
                          <span className="text-ink-muted"> · {item.variantName}</span>
                        )}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatUnits(item.orderedQuantity)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatUnits(item.receivedQuantity)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {formatUnits(item.remainingQuantity)}
                    </td>
                    <td className="px-4 py-2.5">
                      {done ? (
                        <span className="text-xs text-ok">Fully received</span>
                      ) : (
                        <>
                          <div className="flex items-center gap-1">
                            <input
                              inputMode="numeric"
                              autoComplete="off"
                              placeholder="0"
                              aria-label={`Units of ${item.sku} received now`}
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? `receive-${item.id}-error` : undefined}
                              className={clsx(
                                'block w-24 rounded-md border bg-surface px-3 py-1.5 text-right text-sm tabular-nums',
                                error ? 'border-danger' : 'border-line',
                              )}
                              {...form.register(`lines.${index}.quantity`)}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Receive all ${item.remainingQuantity} remaining of ${item.sku}`}
                              onClick={() =>
                                form.setValue(
                                  `lines.${index}.quantity`,
                                  String(item.remainingQuantity),
                                  { shouldDirty: true, shouldValidate: form.formState.isSubmitted },
                                )
                              }
                            >
                              All
                            </Button>
                          </div>
                          {error && (
                            <p
                              id={`receive-${item.id}-error`}
                              role="alert"
                              className="mt-1 text-xs text-danger"
                            >
                              {error}
                            </p>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TextAreaField
          label="Note (optional)"
          rows={2}
          hint="e.g. the delivery note number or the condition of the goods"
          error={errors.note?.message}
          {...form.register('note')}
        />
      </fieldset>
      {unconfirmed ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={clear} disabled={receive.isPending}>
            Start over
          </Button>
          <Button loading={receive.isPending} onClick={() => void send(unconfirmed)}>
            Retry receipt
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={fillRemaining} disabled={outstanding.length === 0}>
              Receive all remaining
            </Button>
            <Button variant="ghost" onClick={clear}>
              Clear
            </Button>
          </div>
          <Button type="submit" loading={receive.isPending}>
            Review receipt
          </Button>
        </div>
      )}

      <Dialog
        open={pending !== null}
        title={`Receive into ${order.warehouse.code}?`}
        description={`Stock is added to ${order.warehouse.name} as soon as you confirm.`}
        onClose={() => (receive.isPending ? undefined : setPending(null))}
      >
        {summary && (
          <div className="space-y-4">
            <ul className="divide-y divide-line rounded-md border border-line text-sm">
              {summary.lines.map((line) => (
                <li key={line.sku} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="font-mono text-xs font-medium">{line.sku}</span>{' '}
                    <span className="text-ink-muted">{line.name}</span>
                  </span>
                  <span className="font-medium tabular-nums">{formatUnits(line.quantity)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm">
              {formatUnits(summary.units)} unit{summary.units === 1 ? '' : 's'} across{' '}
              {summary.lines.length} line{summary.lines.length === 1 ? '' : 's'}.
              {pending?.request.note && (
                <span className="block text-ink-muted">Note: {pending.request.note}</span>
              )}
            </p>
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button
                variant="secondary"
                onClick={() => setPending(null)}
                disabled={receive.isPending}
              >
                Back
              </Button>
              <Button onClick={() => pending && void send(pending)} loading={receive.isPending}>
                Confirm receipt
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </form>
  );
}
