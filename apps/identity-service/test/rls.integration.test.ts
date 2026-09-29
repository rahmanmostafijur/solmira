import { assertRowLevelSecurityEnforced } from '@solmira/service-kit';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * Database-level proof of tenant isolation. These tests bypass the application entirely and
 * talk SQL to PostgreSQL as the runtime role, so they show what happens when application code
 * is wrong: a missing WHERE clause, a guessed ID, a forged organization_id.
 */
const owner = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 });
// One connection, so every test reuses the same pooled session: proves context does not leak.
const app = new pg.Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });

const orgA = uuidv7();
const orgB = uuidv7();
const alice = uuidv7(); // owner of A
const bob = uuidv7(); // owner of B
const memberA = uuidv7();
const memberB = uuidv7();
const invitationB = uuidv7();

async function asTenant<T>(
  scope: { organizationId: string | null; userId: string | null },
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('app.organization_id', $1, true), set_config('app.user_id', $2, true)`,
      [scope.organizationId ?? '', scope.userId ?? ''],
    );
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const inA = { organizationId: orgA, userId: alice };

describe('PostgreSQL Row Level Security (runtime role)', () => {
  beforeAll(async () => {
    const { rows } = await owner.query<{ id: string }>(`select id from roles where key = 'OWNER'`);
    const ownerRole = rows[0]!.id;
    await owner.query(
      `insert into users (id, email, password_hash, full_name) values
         ($1, $2, 'x', 'Alice Northwind'), ($3, $4, 'x', 'Bob Harbor')`,
      [alice, `alice-${orgA}@northwind.test`, bob, `bob-${orgB}@harbor.test`],
    );
    await owner.query(
      `insert into organizations (id, name, slug) values ($1, 'Northwind Traders', $2), ($3, 'Harbor Supply', $4)`,
      [orgA, `northwind-${orgA.slice(-8)}`, orgB, `harbor-${orgB.slice(-8)}`],
    );
    await owner.query(
      `insert into organization_members (id, organization_id, user_id, role_id) values
         ($1, $2, $3, $6), ($4, $5, $7, $6)`,
      [memberA, orgA, alice, memberB, orgB, ownerRole, bob],
    );
    await owner.query(
      `insert into invitations (id, organization_id, email, role_id, token_hash, invited_by_user_id, expires_at)
       values ($1, $2, 'new.hire@harbor.test', $3, $4, $5, now() + interval '7 days')`,
      [invitationB, orgB, ownerRole, `hash-${invitationB}`, bob],
    );
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('runs as a role that cannot bypass RLS, while the owner role is detected as unsafe', async () => {
    await expect(assertRowLevelSecurityEnforced(app)).resolves.toBeUndefined();
    await expect(assertRowLevelSecurityEnforced(owner)).rejects.toThrow(
      /bypasses Row Level Security/,
    );
  });

  it('sees no tenant rows at all without a tenant context (default deny)', async () => {
    const counts = await asTenant({ organizationId: null, userId: null }, async (client) => {
      const { rows } = await client.query<{ orgs: string; members: string; invitations: string }>(`
        select (select count(*) from organizations) as orgs,
               (select count(*) from organization_members) as members,
               (select count(*) from invitations) as invitations`);
      return rows[0];
    });

    expect(counts).toEqual({ orgs: '0', members: '0', invitations: '0' });
  });

  it('cannot read another tenant even when asking for its rows explicitly', async () => {
    const leaked = await asTenant(inA, async (client) => {
      const orgs = await client.query('select id from organizations where id = $1', [orgB]);
      const members = await client.query(
        'select id from organization_members where organization_id = $1',
        [orgB],
      );
      const byId = await client.query('select id from organization_members where id = $1', [
        memberB,
      ]);
      const invitations = await client.query('select id from invitations where id = $1', [
        invitationB,
      ]);
      return [orgs.rowCount, members.rowCount, byId.rowCount, invitations.rowCount];
    });

    expect(leaked).toEqual([0, 0, 0, 0]);
  });

  it('only returns its own tenant when a query forgets the WHERE clause', async () => {
    const organizationIds = await asTenant(inA, async (client) => {
      const { rows } = await client.query<{ organization_id: string }>(
        'select distinct organization_id from organization_members',
      );
      return rows.map((row) => row.organization_id);
    });

    expect(organizationIds).toEqual([orgA]);
  });

  it('cannot update or delete another tenant rows (they are invisible, so 0 rows change)', async () => {
    const affected = await asTenant(inA, async (client) => {
      const renamed = await client.query(
        `update organizations set name = 'Hijacked' where id = $1`,
        [orgB],
      );
      const promoted = await client.query(
        `update organization_members set status = 'suspended' where id = $1`,
        [memberB],
      );
      const revoked = await client.query('delete from invitations where id = $1', [invitationB]);
      const removed = await client.query(
        'delete from organization_members where organization_id = $1',
        [orgB],
      );
      return [renamed.rowCount, promoted.rowCount, revoked.rowCount, removed.rowCount];
    });

    expect(affected).toEqual([0, 0, 0, 0]);
    const { rows } = await owner.query('select name from organizations where id = $1', [orgB]);
    expect(rows[0].name).toBe('Harbor Supply');
    const survivors = await owner.query(
      'select count(*)::int as n from organization_members where organization_id = $1',
      [orgB],
    );
    expect(survivors.rows[0].n).toBe(1);
  });

  it('cannot insert rows into another tenant', async () => {
    await expect(
      asTenant(inA, (client) =>
        client.query(
          `insert into invitations (id, organization_id, email, role_id, token_hash, invited_by_user_id, expires_at)
           select $1, $2, 'spy@northwind.test', role_id, $3, $4, now() + interval '1 day'
             from organization_members where id = $5`,
          [uuidv7(), orgB, `hash-${uuidv7()}`, alice, memberA],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      asTenant(inA, (client) =>
        client.query(
          `insert into organization_members (id, organization_id, user_id, role_id)
           select $1, $2, $3, role_id from organization_members where id = $4`,
          [uuidv7(), orgB, alice, memberA],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot move its own rows into another tenant', async () => {
    await expect(
      asTenant(inA, (client) =>
        client.query('update organization_members set organization_id = $1 where id = $2', [
          orgB,
          memberA,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('still allows legitimate work inside its own tenant', async () => {
    const result = await asTenant(inA, async (client) => {
      const renamed = await client.query(
        `update organizations set name = 'Northwind Traders Ltd' where id = $1`,
        [orgA],
      );
      const members = await client.query(
        'select id from organization_members where organization_id = $1',
        [orgA],
      );
      return { renamed: renamed.rowCount, members: members.rows.map((row) => row.id) };
    });

    expect(result).toEqual({ renamed: 1, members: [memberA] });
  });

  it('lets a user see their own memberships across organizations, and nothing more', async () => {
    const visible = await asTenant({ organizationId: null, userId: alice }, async (client) => {
      const orgs = await client.query<{ id: string }>('select id from organizations');
      const members = await client.query<{ id: string }>('select id from organization_members');
      return { orgs: orgs.rows.map((r) => r.id), members: members.rows.map((r) => r.id) };
    });

    expect(visible).toEqual({ orgs: [orgA], members: [memberA] });
  });

  it('does not leak tenant context between transactions on a pooled connection', async () => {
    await asTenant(inA, (client) => client.query('select 1'));
    const afterwards = await asTenant({ organizationId: null, userId: null }, async (client) => {
      const { rows } = await client.query<{ org: string | null }>(
        `select current_setting('app.organization_id', true) as org`,
      );
      const members = await client.query('select id from organization_members');
      return { org: rows[0]!.org, members: members.rowCount };
    });

    expect(afterwards.members).toBe(0);
    expect(afterwards.org ?? '').toBe('');
  });

  it('cannot tamper with the access catalog', async () => {
    const readable = await asTenant(
      inA,
      async (client) => (await client.query('select key from permissions')).rowCount,
    );
    expect(readable).toBeGreaterThan(0);

    await expect(
      asTenant(inA, (client) =>
        client.query(`insert into permissions (key, description) values ('god.mode', 'x')`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const changed = await asTenant(
      inA,
      async (client) =>
        (await client.query(`update role_permissions set permission_key = 'users.delete'`))
          .rowCount,
    );
    expect(changed).toBe(0);
  });

  it('resolves an invitation by token hash without context, and only that invitation', async () => {
    const found = await asTenant({ organizationId: null, userId: null }, async (client) => {
      const { rows } = await client.query(
        'select id, organization_id from find_invitation_by_token_hash($1)',
        [`hash-${invitationB}`],
      );
      const wrong = await client.query('select id from find_invitation_by_token_hash($1)', [
        'hash-unknown',
      ]);
      return { rows, wrong: wrong.rowCount };
    });

    expect(found.rows).toEqual([{ id: invitationB, organization_id: orgB }]);
    expect(found.wrong).toBe(0);
  });
});
