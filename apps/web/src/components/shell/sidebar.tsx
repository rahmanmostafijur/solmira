'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePermissions } from '@/components/auth/can';
import { isActive, visibleSections } from './navigation';

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can, organization } = usePermissions();
  const sections = visibleSections(can, organization !== null);

  return (
    <nav aria-label="Primary" className="px-3 py-4">
      {sections.map((section) => (
        <div key={section.title} className="mb-6">
          <p className="px-2 pb-2 text-[11px] font-medium tracking-wider text-ink-muted uppercase">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={clsx(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-ink-muted hover:bg-canvas hover:text-ink',
                    )}
                  >
                    <item.icon aria-hidden className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      {/* Mark: a sun (sol) rising over a horizon line (mira, "behold"). */}
      <svg aria-hidden viewBox="0 0 32 32" className="size-6 shrink-0">
        <rect width="32" height="32" rx="7" className="fill-accent" />
        <path d="M9 19a7 7 0 0 1 14 0Z" fill="#fff" />
        <path d="M6.5 22.5h19" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="font-semibold tracking-tight">Solmira</span>
    </span>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-14 items-center border-b border-line px-5">
        <Wordmark />
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavLinks />
      </div>
    </aside>
  );
}
