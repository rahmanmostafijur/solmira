import { PERMISSION_CATALOG, ROLE_DEFINITIONS } from '@solmira/contracts';
import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { syncAccessCatalog } from '../src/database/migrations.js';

const owner = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 });

afterAll(() => owner.end());

describe('access catalog sync', () => {
  it('removes permissions that left the catalog together with their role assignments', async () => {
    const removed = 'legacy.removed_permission';
    await owner.query(`insert into permissions (key, description) values ($1, 'Removed')`, [
      removed,
    ]);
    await owner.query(
      `insert into role_permissions (role_id, permission_key)
       select id, $1 from roles where organization_id is null`,
      [removed],
    );

    await syncAccessCatalog(owner);

    const permission = await owner.query('select 1 from permissions where key = $1', [removed]);
    const assignments = await owner.query(
      'select 1 from role_permissions where permission_key = $1',
      [removed],
    );
    expect(permission.rowCount).toBe(0);
    expect(assignments.rowCount).toBe(0);
  });

  it('keeps every catalog permission and each system role assignment', async () => {
    await syncAccessCatalog(owner);

    const permissions = await owner.query<{ key: string }>('select key from permissions');
    expect(permissions.rows.map((row) => row.key).sort()).toEqual(
      Object.keys(PERMISSION_CATALOG).sort(),
    );

    const { rows } = await owner.query<{ key: string; count: string }>(
      `select r.key, count(*)::text as count
         from roles r join role_permissions rp on rp.role_id = r.id
        where r.organization_id is null group by r.key`,
    );
    for (const row of rows)
      expect(Number(row.count), row.key).toBe(
        ROLE_DEFINITIONS[row.key as keyof typeof ROLE_DEFINITIONS].permissions.length,
      );
  });
});
