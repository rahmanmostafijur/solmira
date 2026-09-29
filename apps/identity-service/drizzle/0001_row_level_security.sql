-- Row Level Security for tenant-owned identity data.
--
-- Tenant context arrives per transaction through two settings, set with set_config(..., true)
-- by the application's tenant-scope helper (they vanish at COMMIT/ROLLBACK):
--   app.organization_id  the active organization from the verified access token
--   app.user_id          the authenticated user
-- Missing settings resolve to NULL, and NULL never equals anything, so a query that runs without
-- context sees no tenant rows at all: the default is deny.
--
-- Policies are enabled but not FORCEd: the owner role (migrations) keeps full access, while the
-- runtime role is not the owner and is always filtered. The service refuses readiness if its
-- runtime role owns these tables or has BYPASSRLS.

CREATE FUNCTION app_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- organization_members ------------------------------------------------------------------------
-- Readable: members of the active organization, plus the caller's own memberships elsewhere
-- (needed to list and switch organizations). Writable: only within the active organization.
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_members_select ON organization_members FOR SELECT
  USING (organization_id = app_current_organization_id() OR user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY organization_members_insert ON organization_members FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
CREATE POLICY organization_members_update ON organization_members FOR UPDATE
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
CREATE POLICY organization_members_delete ON organization_members FOR DELETE
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

-- organizations -------------------------------------------------------------------------------
-- Readable: the active organization and organizations the caller belongs to.
-- Writable: only the active organization. Creating an organization sets the context to the new
-- id first, so the INSERT passes WITH CHECK only for the row being created.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_select ON organizations FOR SELECT
  USING (
    id = app_current_organization_id()
    OR EXISTS (
      SELECT 1 FROM organization_members m
       WHERE m.organization_id = organizations.id AND m.user_id = app_current_user_id()
    )
  );
--> statement-breakpoint
CREATE POLICY organizations_insert ON organizations FOR INSERT
  WITH CHECK (id = app_current_organization_id());
--> statement-breakpoint
CREATE POLICY organizations_update ON organizations FOR UPDATE
  USING (id = app_current_organization_id())
  WITH CHECK (id = app_current_organization_id());
--> statement-breakpoint
CREATE POLICY organizations_delete ON organizations FOR DELETE
  USING (id = app_current_organization_id());
--> statement-breakpoint

-- invitations ---------------------------------------------------------------------------------
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitations_tenant ON invitations FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- Accepting an invitation starts from a token, before any organization context exists. This
-- narrow SECURITY DEFINER lookup (runs as the owner) resolves exactly one invitation by the hash
-- of its secret token; everything after it runs in the invitation's organization context.
CREATE FUNCTION find_invitation_by_token_hash(p_token_hash text)
  RETURNS TABLE (
    id uuid,
    organization_id uuid,
    email text,
    role_id uuid,
    expires_at timestamptz,
    accepted_at timestamptz,
    revoked_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT i.id, i.organization_id, i.email, i.role_id, i.expires_at, i.accepted_at, i.revoked_at
      FROM invitations i
     WHERE i.token_hash = p_token_hash
  $$;
--> statement-breakpoint

-- Access catalog ------------------------------------------------------------------------------
-- The runtime role may read the catalog but never change it: with RLS on and only a SELECT
-- policy, INSERT/UPDATE/DELETE match no policy and are denied. The owner syncs it on deploy.
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY permissions_read ON permissions FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_read ON roles FOR SELECT
  USING (organization_id IS NULL OR organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY role_permissions_read ON role_permissions FOR SELECT USING (true);
