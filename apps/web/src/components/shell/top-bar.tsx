'use client';

import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { findNavItem } from './navigation';
import { OrganizationSwitcher } from './organization-switcher';
import { NavLinks, Wordmark } from './sidebar';
import { UserMenu } from './user-menu';

const ENVIRONMENT_LABEL = process.env.NODE_ENV === 'production' ? null : 'Development';

function Breadcrumbs() {
  const match = findNavItem(usePathname());
  if (!match) return null;

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1.5 text-sm">
        <li className="text-ink-muted">{match.section.title}</li>
        <li aria-hidden className="text-line">
          /
        </li>
        <li aria-current="page" className="font-medium">
          {match.item.label}
        </li>
      </ol>
    </nav>
  );
}

/** Below the lg breakpoint the sidebar is replaced by this drawer. */
function MobileNavigation() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="rounded-md p-1.5 text-ink-muted hover:bg-canvas hover:text-ink"
      >
        <Menu aria-hidden className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="relative w-64 bg-surface shadow-xl"
          >
            <div className="flex h-14 items-center justify-between border-b border-line px-5">
              <Wordmark />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1 text-ink-muted hover:bg-canvas"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-8">
      <MobileNavigation />
      <OrganizationSwitcher />
      <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
      <div className="hidden sm:block">
        <Breadcrumbs />
      </div>
      <div className="ml-auto flex items-center gap-3">
        {ENVIRONMENT_LABEL && (
          <span className="hidden rounded border border-warn/30 bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn sm:inline">
            {ENVIRONMENT_LABEL}
          </span>
        )}
        <UserMenu />
      </div>
    </header>
  );
}
