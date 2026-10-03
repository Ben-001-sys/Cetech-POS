# First Owner bootstrap — CETECH POS staging

This runbook describes a controlled operator action. It was not executed in the source-remediation task.
Do not run it against production. Do not add a public or unauthenticated first-admin route.

## Why this exists

The original staging fixture for `org_a` has operational staff (`cashier_a`, `manager_a`) and no row in `pos_organization_memberships`. Verify the current organization before using this procedure; fixture state is not evidence of live state.
Organization Owner, Admin, and Support are a separate axis from cashier/manager location roles.
After one active Owner exists, later staff, roles, locations, registers, and devices are administered in the product.

## Preconditions

- Exact source candidate has fresh independent review.
- Trusted Exact SHA Preview is a later phase, not this step.
- The existing approved operator authority covers this exact staging organization and first-Owner action. Record its change reference and the operator's verified identity in the audit event.
- Operator uses the staging Supabase SQL editor as the privileged database operator (`postgres` or `supabase_admin`), never a browser session or application service-role credential.
- The person already has an active Auth user.
- That user's `app_metadata` contains `actor_id` and `organization_id` for the staging organization.
- `user_metadata` is never used as authority.
- No password, service-role key, or JWT is copied into tickets, logs, or this file.

## One-time membership

The routine membership RPC now rechecks current Owner/Admin authority under an organization lock. It cannot create the first Owner in an organization with no memberships. Do not weaken that guard or add a public bootstrap exception.

Replace the placeholders with the verified Auth user UUID, its exact `app_metadata.actor_id` and organization, and the approved operator identity/change reference. The operator transaction below rechecks the Auth mapping, locks the organization using the same lock mode as routine membership/access changes, and refuses organizations that already have a usable Owner or any membership. An existing membership requires the separate controlled ownership-recovery procedure; it must not be overwritten by bootstrap.

```sql
BEGIN;

DO $bootstrap$
DECLARE
  bootstrap_organization_id text := 'org_a';
  bootstrap_auth_user_id uuid := '<existing-auth-user-uuid>';
  bootstrap_actor_id text := '<existing-actor-id>';
  bootstrap_operator_actor_id text := '<verified-operator-actor-id>';
  bootstrap_operator_reference text := '<approved-change-reference>';
  bootstrap_correlation_id uuid := gen_random_uuid();
  bootstrap_membership public.pos_organization_memberships%ROWTYPE;
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin')
     OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'privileged database operator is required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = bootstrap_auth_user_id
      AND raw_app_meta_data->>'actor_id' = bootstrap_actor_id
      AND raw_app_meta_data->>'organization_id' = bootstrap_organization_id
      AND deleted_at IS NULL
      AND (banned_until IS NULL OR banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'verified active Auth mapping is required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.pos_organizations
  WHERE id = bootstrap_organization_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization was not found' USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pos_organization_memberships membership
    WHERE membership.organization_id = bootstrap_organization_id
      AND membership.control_role = 'owner' AND membership.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.pos_staff_access_controls access
        WHERE access.organization_id = bootstrap_organization_id
          AND access.actor_id = membership.actor_id AND access.status = 'disabled'
      )
  ) THEN
    RAISE EXCEPTION 'organization already has a usable Owner' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pos_organization_memberships
    WHERE organization_id = bootstrap_organization_id
  ) THEN
    RAISE EXCEPTION 'existing memberships require controlled ownership recovery' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pos_staff_access_controls
    WHERE organization_id = bootstrap_organization_id
      AND actor_id = bootstrap_actor_id AND status = 'disabled'
  ) THEN
    RAISE EXCEPTION 'bootstrap target has disabled POS access' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.pos_organization_memberships
    (organization_id, actor_id, control_role, status)
  VALUES (bootstrap_organization_id, bootstrap_actor_id, 'owner', 'active')
  RETURNING * INTO bootstrap_membership;

  INSERT INTO public.pos_admin_audit_events
    (organization_id, actor_id, action, target_type, target_id,
     before_state, after_state, correlation_id)
  VALUES (
    bootstrap_organization_id, bootstrap_operator_actor_id,
    'organization_membership.set', 'organization_membership', bootstrap_actor_id,
    NULL, to_jsonb(bootstrap_membership) || jsonb_build_object(
      'bootstrap', true, 'operatorReference', bootstrap_operator_reference,
      'authUserId', bootstrap_auth_user_id
    ), bootstrap_correlation_id
  );
END;
$bootstrap$;

COMMIT;
```

Any failed check or audit insertion aborts the transaction. Repeat execution cannot replace an existing membership. No application RPC, credentials, Auth metadata, sales, or operational assignments are changed by this transaction. A disabled target requires controlled access recovery before bootstrap, rather than silently reactivating it.

After that transaction succeeds, the new active Owner satisfies the routine RPC's caller guard. If POS access must be explicit rather than the missing-row default:

```sql
SELECT pos_admin_set_staff_access_status(
  'org_a',
  '<existing-actor-id>',
  'active',
  'first owner bootstrap',
  '<existing-actor-id>',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
);
```

Where full operational acceptance is required, the same person also needs an operational `manager` assignment and register assignments at the locations they will exercise. Use the existing assignment tables or, after this Owner can sign in, the Staff & access screen. Do not put `admin` into the cashier/manager role check.

## Verification

```sql
SELECT organization_id, actor_id, control_role, status
FROM pos_organization_memberships
WHERE organization_id = 'org_a';

SELECT actor_id, organization_id, location_id, role
FROM pos_staff_location_assignments
WHERE organization_id = 'org_a'
  AND actor_id = '<existing-actor-id>';
```

Expected: one active `owner` row. A later attempt to disable or demote that only Owner must fail with the last-owner protection already in `pos_admin_set_control_membership`.

Verify the bootstrap audit using its target actor and recorded change reference. The audit's `actor_id` identifies the verified operator; its target identifies the new Owner.

```sql
SELECT actor_id, target_id, after_state, correlation_id
FROM pos_admin_audit_events
WHERE organization_id = 'org_a'
  AND action = 'organization_membership.set'
  AND target_id = '<existing-actor-id>'
  AND after_state->>'operatorReference' = '<approved-change-reference>';
```

## Forward migration still required before topology mutations

`20260923140000_pos_admin_topology.sql` adds location status and the location, register, and device save functions.
Apply it to staging only as its own reviewed operation. Do not rewrite `20260922123000_pos_admin_control_plane.sql`.
Until that migration is applied, location administration in the new build cannot persist.

## After bootstrap

Owner signs in and uses Add staff. Direct-created accounts receive a temporary password and must change it before the POS workspace opens. Invitation remains available and keeps POS access disabled until setup is complete. No further routine Supabase dashboard edits should be required for staff, roles, locations, registers, or devices.
