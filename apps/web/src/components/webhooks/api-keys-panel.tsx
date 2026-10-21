'use client';

import { API_KEY_SCOPES, type ApiKeyScope, type CreatedApiKey } from '@solmira/contracts';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { usePermissions } from '@/components/auth/can';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { SecretDisplay } from '@/components/ui/secret-display';
import { TBody, Table, THead, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/webhook-queries';

/** The keys a tenant's backend uses to call the ingestion API. The key itself is shown only once. */
export function ApiKeysPanel({ organizationId, applicationId }: Ids) {
  const { can } = usePermissions();
  const notify = useToast();
  const keys = useApiKeys(organizationId, applicationId, can('api_keys.read'));
  const create = useCreateApiKey(organizationId, applicationId);
  const revoke = useRevokeApiKey(organizationId, applicationId);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey>();
  const [revoking, setRevoking] = useState<{ id: string; name: string }>();

  return (
    <Panel
      title="API keys"
      description="Your backend sends messages with one of these."
      actions={
        can('api_keys.create') && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            New API key
          </Button>
        )
      }
    >
      <Dialog open={creating} title="New API key" onClose={() => setCreating(false)}>
        <ApiKeyForm
          onCancel={() => setCreating(false)}
          onSubmit={async (name, scopes) => {
            setCreated(await create.mutateAsync({ name, scopes }));
            setCreating(false);
          }}
        />
      </Dialog>
      <Dialog
        open={created !== undefined}
        title="Copy your API key"
        onClose={() => setCreated(undefined)}
      >
        {created && (
          <div className="space-y-4">
            <Alert tone="warning">This is the only time the key is shown. Store it safely.</Alert>
            <SecretDisplay label="API key" value={created.key} />
            <div className="flex justify-end">
              <Button onClick={() => setCreated(undefined)}>Done</Button>
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={revoking !== undefined}
        title={`Revoke ${revoking?.name ?? 'key'}?`}
        description="Requests using this key stop working immediately. This cannot be undone."
        confirmLabel="Revoke"
        pending={revoke.isPending}
        onCancel={() => setRevoking(undefined)}
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking.id, {
            onSuccess: () => {
              setRevoking(undefined);
              notify('API key revoked');
            },
            onError: (error) => notify(describeError(error), 'error'),
          })
        }
      />
      {!can('api_keys.read') ? (
        <p className="p-5 text-sm text-ink-muted">Your role cannot view API keys.</p>
      ) : keys.isPending ? (
        <LoadingRows label="Loading API keys" />
      ) : keys.isError ? (
        <div className="p-5">
          <Alert tone="error">{describeError(keys.error)}</Alert>
        </div>
      ) : keys.data.items.length === 0 ? (
        <EmptyState title="No API keys yet" description="Create one to start sending messages." />
      ) : (
        <Table caption="API keys">
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Key</Th>
              <Th>Scopes</Th>
              <Th>Last used</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {keys.data.items.map((key) => (
              <Tr key={key.id}>
                <Td>
                  {key.name} {key.revokedAt && <Badge tone="danger">Revoked</Badge>}
                </Td>
                <Td>
                  <code className="font-mono text-xs">{key.prefix}…</code>
                </Td>
                <Td className="text-ink-muted">{key.scopes.join(', ')}</Td>
                <Td className="text-ink-muted">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                </Td>
                <Td className="text-right">
                  {can('api_keys.delete') && !key.revokedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRevoking({ id: key.id, name: key.name })}
                    >
                      Revoke
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

interface Ids {
  organizationId: string;
  applicationId: string;
}

function ApiKeyForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, scopes: ApiKeyScope[]) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['messages:write']);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') return setError('Enter a name');
    if (scopes.length === 0) return setError('Choose at least one scope');
    setPending(true);
    try {
      await onSubmit(name.trim(), scopes);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Scopes</legend>
        {API_KEY_SCOPES.map((scope) => (
          <label key={scope} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={() =>
                setScopes((current) =>
                  current.includes(scope)
                    ? current.filter((s) => s !== scope)
                    : [...current, scope],
                )
              }
            />
            <code className="font-mono text-xs">{scope}</code>
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Create key
        </Button>
      </div>
    </form>
  );
}
