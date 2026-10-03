-- DRAFT FOR ROOT REVIEW ONLY. NOT A MIGRATION; NOT EXECUTED.
-- Allocate an additive migration via Supabase CLI before adoption.
-- Retains both existing RPC signatures, audit writes and service-role grants.
-- Restores no Auth identity and deletes no account, access history or commerce.
-- Identity mapping/credential changes stay in the provider-neutral server
-- adapter; these guards protect current POS authority under the organization
-- lock. A linked Auth account and any additional active-work guard remain
-- separate BFF concerns before a broader offboarding/unassignment feature.
-- Required pgTAP: admin cannot change Owner; self deactivation; concurrent
-- owner grant vs disable; disabled-owner cannot count as the fallback Owner;
-- caller disabled or demoted while BFF waits; audit failure rolls back status
-- and session revocation; staged new account provisioning remains supported.
-- Avoid rewriting the already-applied 20260922123000 migration.

CREATE OR REPLACE FUNCTION pos_admin_set_control_membership(
  p_organization_id text,
  p_target_actor_id text,
  p_control_role text,
  p_status text,
  p_actor_id text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing public.pos_organization_memberships%ROWTYPE;
  saved public.pos_organization_memberships%ROWTYPE;
  active_owner_count integer;
  before_json jsonb;
  after_json jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_target_actor_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'organization, target actor and actor are required' USING ERRCODE = '23502';
  END IF;
  IF p_control_role NOT IN ('owner', 'admin', 'support') THEN
    RAISE EXCEPTION 'control role is invalid' USING ERRCODE = '23514';
  END IF;
  IF p_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'membership status is invalid' USING ERRCODE = '23514';
  END IF;

  -- Serialize membership changes for the organization.
  PERFORM 1
  FROM public.pos_organizations
  WHERE id = p_organization_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization was not found' USING ERRCODE = '23503';
  END IF;

  -- Recheck current authority while holding the same organization lock used by
  -- both protected membership/access RPCs. BFF checks remain mandatory as well.
  IF NOT EXISTS (
    SELECT 1 FROM public.pos_organization_memberships caller
    WHERE caller.organization_id = p_organization_id
      AND caller.actor_id = p_actor_id
      AND caller.status = 'active'
      AND caller.control_role IN ('owner', 'admin')
      AND NOT EXISTS (
        SELECT 1 FROM public.pos_staff_access_controls access
        WHERE access.organization_id = p_organization_id
          AND access.actor_id = p_actor_id AND access.status = 'disabled'
      )
  ) THEN
    RAISE EXCEPTION 'current owner or admin authority is required' USING ERRCODE = '42501';
  END IF;


  IF NOT EXISTS (
    SELECT 1 FROM public.pos_organization_memberships caller
    WHERE caller.organization_id = p_organization_id
      AND caller.actor_id = p_actor_id
      AND caller.control_role = 'owner' AND caller.status = 'active'
  ) AND (
    (p_control_role = 'owner' AND p_status = 'active') OR EXISTS (
      SELECT 1 FROM public.pos_organization_memberships target
      WHERE target.organization_id = p_organization_id
        AND target.actor_id = p_target_actor_id
        AND target.control_role = 'owner' AND target.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'only an owner may grant or change owner authority' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO existing
  FROM public.pos_organization_memberships
  WHERE organization_id = p_organization_id
    AND actor_id = p_target_actor_id
  FOR UPDATE;

  IF FOUND THEN
    before_json := to_jsonb(existing);

    -- Never allow the last active owner to be demoted or disabled.
    IF existing.control_role = 'owner'
       AND existing.status = 'active'
       AND (p_control_role <> 'owner' OR p_status <> 'active') THEN
      SELECT COUNT(*)
      INTO active_owner_count
      FROM public.pos_organization_memberships owner
      WHERE owner.organization_id = p_organization_id
        AND owner.control_role = 'owner'
        AND owner.status = 'active'
        AND owner.actor_id <> p_target_actor_id
        AND NOT EXISTS (
          SELECT 1 FROM public.pos_staff_access_controls access
          WHERE access.organization_id = p_organization_id
            AND access.actor_id = owner.actor_id AND access.status = 'disabled'
        );

      IF active_owner_count < 1 THEN
        RAISE EXCEPTION 'organization must retain at least one active owner'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    UPDATE public.pos_organization_memberships
    SET control_role = p_control_role,
        status = p_status,
        updated_at = now()
    WHERE organization_id = p_organization_id
      AND actor_id = p_target_actor_id
    RETURNING * INTO saved;
  ELSE
    INSERT INTO public.pos_organization_memberships (
      organization_id,
      actor_id,
      control_role,
      status
    ) VALUES (
      p_organization_id,
      p_target_actor_id,
      p_control_role,
      p_status
    )
    RETURNING * INTO saved;
    before_json := NULL;
  END IF;

  after_json := to_jsonb(saved);

  INSERT INTO public.pos_admin_audit_events (
    organization_id,
    actor_id,
    action,
    target_type,
    target_id,
    before_state,
    after_state,
    correlation_id
  ) VALUES (
    p_organization_id,
    p_actor_id,
    'organization_membership.set',
    'organization_membership',
    p_target_actor_id,
    before_json,
    after_json,
    p_correlation_id
  );

  RETURN jsonb_build_object(
    'organizationId', saved.organization_id,
    'actorId', saved.actor_id,
    'controlRole', saved.control_role,
    'status', saved.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION pos_admin_set_staff_access_status(
  p_organization_id text,
  p_target_actor_id text,
  p_status text,
  p_reason text,
  p_actor_id text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing public.pos_staff_access_controls%ROWTYPE;
  saved public.pos_staff_access_controls%ROWTYPE;
  before_json jsonb;
  after_json jsonb;
  revoked_count integer := 0;
BEGIN
  IF p_organization_id IS NULL OR p_target_actor_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'organization, target actor and actor are required' USING ERRCODE = '23502';
  END IF;
  IF p_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'staff access status is invalid' USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.pos_organizations
  WHERE id = p_organization_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization was not found' USING ERRCODE = '23503';
  END IF;

  -- Recheck current authority while holding the same organization lock used by
  -- both protected membership/access RPCs. BFF checks remain mandatory as well.
  IF NOT EXISTS (
    SELECT 1 FROM public.pos_organization_memberships caller
    WHERE caller.organization_id = p_organization_id
      AND caller.actor_id = p_actor_id
      AND caller.status = 'active'
      AND caller.control_role IN ('owner', 'admin')
      AND NOT EXISTS (
        SELECT 1 FROM public.pos_staff_access_controls access
        WHERE access.organization_id = p_organization_id
          AND access.actor_id = p_actor_id AND access.status = 'disabled'
      )
  ) THEN
    RAISE EXCEPTION 'current owner or admin authority is required' USING ERRCODE = '42501';
  END IF;


  IF p_status = 'disabled' AND p_target_actor_id = p_actor_id THEN
    RAISE EXCEPTION 'you cannot deactivate your own current management access' USING ERRCODE = '42501';
  END IF;

  -- Owner authority must be transferred/demoted through the protected
  -- membership operation before POS deactivation. This closes a concurrent
  -- owner-grant/deactivate race that an earlier directory read cannot prevent.
  IF EXISTS (
    SELECT 1 FROM public.pos_organization_memberships target
    WHERE target.organization_id = p_organization_id
      AND target.actor_id = p_target_actor_id
      AND target.control_role = 'owner' AND target.status = 'active'
  ) AND (
    p_status = 'disabled' OR NOT EXISTS (
      SELECT 1 FROM public.pos_organization_memberships caller
      WHERE caller.organization_id = p_organization_id
        AND caller.actor_id = p_actor_id
        AND caller.control_role = 'owner' AND caller.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'owner authority must be transferred before changing this access' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO existing
  FROM public.pos_staff_access_controls
  WHERE organization_id = p_organization_id
    AND actor_id = p_target_actor_id
  FOR UPDATE;

  before_json := CASE WHEN FOUND THEN to_jsonb(existing) ELSE NULL END;

  INSERT INTO public.pos_staff_access_controls (
    organization_id,
    actor_id,
    status,
    reason,
    updated_by_actor_id,
    updated_at
  ) VALUES (
    p_organization_id,
    p_target_actor_id,
    p_status,
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    p_actor_id,
    now()
  )
  ON CONFLICT (organization_id, actor_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    reason = EXCLUDED.reason,
    updated_by_actor_id = EXCLUDED.updated_by_actor_id,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO saved;

  IF p_status = 'disabled' THEN
    UPDATE public.pos_staff_sessions
    SET revoked_at = now()
    WHERE organization_id = p_organization_id
      AND actor_id = p_target_actor_id
      AND revoked_at IS NULL;
    GET DIAGNOSTICS revoked_count = ROW_COUNT;
  END IF;

  after_json := to_jsonb(saved);

  INSERT INTO public.pos_admin_audit_events (
    organization_id,
    actor_id,
    action,
    target_type,
    target_id,
    before_state,
    after_state,
    correlation_id
  ) VALUES (
    p_organization_id,
    p_actor_id,
    'staff.access_status.set',
    'staff_access',
    p_target_actor_id,
    before_json,
    after_json || jsonb_build_object('revokedSessionCount', revoked_count),
    p_correlation_id
  );

  RETURN jsonb_build_object(
    'organizationId', saved.organization_id,
    'actorId', saved.actor_id,
    'status', saved.status,
    'reason', saved.reason,
    'revokedSessionCount', revoked_count
  );
END;
$$;
