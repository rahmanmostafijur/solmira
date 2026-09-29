import { ROLE_DEFINITIONS, type RoleKey } from '@solmira/contracts';
import clsx from 'clsx';

const STYLES: Record<RoleKey, string> = {
  OWNER: 'bg-accent text-white',
  ADMIN: 'bg-accent-soft text-accent',
  MANAGER: 'bg-canvas text-ink ring-1 ring-line ring-inset',
  STAFF: 'bg-canvas text-ink-muted ring-1 ring-line ring-inset',
  VIEWER: 'text-ink-muted ring-1 ring-line ring-inset',
};

export function RoleBadge({ role }: { role: RoleKey }) {
  return (
    <span
      className={clsx('inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium', STYLES[role])}
    >
      {ROLE_DEFINITIONS[role].name}
    </span>
  );
}
