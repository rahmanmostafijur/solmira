'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { usePermissions } from '@/components/auth/can';
import { Alert } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { visibleSections } from '@/components/shell/navigation';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { organization, can } = usePermissions();
  const pathname = usePathname();

  if (!organization) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert tone="info" title="No organization selected">
          <Link href="/organizations" className="font-medium text-accent hover:underline">
            Choose or create an organization
          </Link>{' '}
          to manage its settings.
        </Alert>
      </div>
    );
  }

  const tabs =
    visibleSections(can, true).find((section) => section.title === 'Settings')?.items ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" description={`Manage ${organization.name}.`} />
      <nav aria-label="Settings" className="mb-6 flex gap-1 border-b border-line">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                '-mb-px border-b-2 px-3 py-2 text-sm',
                active
                  ? 'border-accent font-medium text-accent'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
