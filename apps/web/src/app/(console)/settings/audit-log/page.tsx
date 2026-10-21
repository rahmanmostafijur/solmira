'use client';

import { AUDITED_EVENT_TYPES } from '@solmira/contracts';
import { useState } from 'react';
import { RequireOrganization } from '@/components/auth/require-organization';
import {
  actionLabel,
  actorLabel,
  describeDetails,
  targetLabel,
} from '@/components/audit/audit-format';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/pagination';
import { TBody, Table, THead, Td, Th, Tr } from '@/components/ui/table';
import { describeError } from '@/lib/api/client';
import { useAuditLog } from '@/lib/audit-queries';

function AuditLog({ organizationId }: { organizationId: string }) {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const log = useAuditLog(organizationId, { page, pageSize: 25, ...(action ? { action } : {}) });

  return (
    <Panel
      title="Audit log"
      description="Who did what, newest first. Records cannot be changed or removed."
      actions={
        <select
          aria-label="Filter by action"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
        >
          <option value="">All actions</option>
          {AUDITED_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {actionLabel(type)}
            </option>
          ))}
        </select>
      }
    >
      {log.isPending ? (
        <LoadingRows label="Loading the audit log" />
      ) : log.isError ? (
        <div className="p-5">
          <Alert tone="error">{describeError(log.error)}</Alert>
        </div>
      ) : log.data.items.length === 0 ? (
        <EmptyState title="Nothing recorded" description="Administrative actions appear here." />
      ) : (
        <>
          <Table caption="Audit log">
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Target</Th>
              </Tr>
            </THead>
            <TBody>
              {log.data.items.map((record) => (
                <Tr key={record.id}>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {new Date(record.occurredAt).toLocaleString()}
                  </Td>
                  <Td>
                    <span title={record.actorId ?? undefined}>{actorLabel(record)}</span>
                  </Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer">{actionLabel(record.action)}</summary>
                      <pre className="mt-2 max-w-md overflow-auto rounded bg-canvas p-2 font-mono text-xs">
                        {describeDetails(record.details)}
                      </pre>
                    </details>
                  </Td>
                  <Td className="text-ink-muted">
                    {targetLabel(record.targetType)}{' '}
                    <code className="font-mono text-xs">{record.targetId?.slice(0, 8)}</code>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={log.data} onChange={setPage} />
        </>
      )}
    </Panel>
  );
}

export default function AuditLogPage() {
  return (
    <RequireOrganization permission="audit_logs.read">
      {(organization) => <AuditLog organizationId={organization.id} />}
    </RequireOrganization>
  );
}
