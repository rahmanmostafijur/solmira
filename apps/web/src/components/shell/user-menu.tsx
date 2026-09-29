'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { DropdownMenu, MenuItem } from '@/components/ui/dropdown-menu';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function UserMenu() {
  const { session, logout } = useAuth();
  const router = useRouter();
  if (!session) return null;

  return (
    <DropdownMenu
      label="Account menu"
      trigger={
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
        >
          {initials(session.user.fullName) || '?'}
        </span>
      }
      header={
        <div className="border-b border-line px-3 py-2">
          <p className="truncate text-sm font-medium">{session.user.fullName}</p>
          <p className="truncate text-xs text-ink-muted">{session.user.email}</p>
        </div>
      }
    >
      {(close) => (
        <>
          <MenuItem
            onSelect={async () => {
              close();
              await logout();
              router.replace('/login');
            }}
          >
            <LogOut aria-hidden className="size-4 text-ink-muted" />
            Sign out
          </MenuItem>
        </>
      )}
    </DropdownMenu>
  );
}
