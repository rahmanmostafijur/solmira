import type pg from 'pg';

/**
 * Row Level Security silently does nothing for superusers, roles with BYPASSRLS and (unless
 * FORCE is set) table owners. A misconfigured DATABASE_URL would therefore turn tenant isolation
 * off without any error. This check makes that misconfiguration loud: services register it as a
 * readiness check, so an instance connected with a privileged role never receives traffic.
 */
export async function assertRowLevelSecurityEnforced(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    owned_rls_tables: string;
  }>(`
    select r.rolsuper,
           r.rolbypassrls,
           (select count(*) from pg_class c
             where c.relrowsecurity and c.relowner = r.oid) as owned_rls_tables
      from pg_roles r
     where r.rolname = current_user
  `);
  const role = rows[0];
  if (!role) throw new Error('Could not inspect the current database role');
  if (role.rolsuper || role.rolbypassrls || Number(role.owned_rls_tables) > 0) {
    throw new Error(
      'The runtime database role bypasses Row Level Security (superuser, BYPASSRLS or table owner)',
    );
  }
}
