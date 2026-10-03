-- DRAFT local pgTAP regression proposal; not executed against any database.
-- Requires the additive safeguard migration. All synthetic data rolls back.
-- Single-connection tests verify both serialized outcomes, not overlapping timing.
-- Root should add a two-connection barrier test for queued owner grant/disable.
BEGIN;
SELECT no_plan();

INSERT INTO pos_organizations (id, name) VALUES
  ('org_staff_guard', 'Synthetic staff safeguard'),
  ('org_staff_other', 'Synthetic second organization');
INSERT INTO pos_locations (id, organization_id, name)
VALUES ('loc_staff_guard', 'org_staff_guard', 'Synthetic staff location');
INSERT INTO pos_organization_memberships (organization_id, actor_id, control_role, status) VALUES
  ('org_staff_guard', 'staff_sql_owner', 'owner', 'active'),
  ('org_staff_guard', 'staff_sql_disabled_owner', 'owner', 'active'),
  ('org_staff_guard', 'staff_sql_admin', 'admin', 'active'),
  ('org_staff_guard', 'staff_sql_stale', 'admin', 'active');
INSERT INTO pos_staff_access_controls (organization_id, actor_id, status, updated_by_actor_id)
VALUES ('org_staff_guard', 'staff_sql_disabled_owner', 'disabled', 'staff_sql_owner');
INSERT INTO pos_staff_location_assignments (actor_id, organization_id, location_id, role)
VALUES ('staff_sql_cashier', 'org_staff_guard', 'loc_staff_guard', 'cashier');
INSERT INTO pos_staff_sessions (organization_id, actor_id, csrf_token, session_payload, expires_at)
SELECT 'org_staff_guard', actor_id, 'synthetic_csrf',
  jsonb_build_object('actorId', actor_id, 'organizationId', 'org_staff_guard', 'expiresAt', now() + interval '1 hour'),
  now() + interval '1 hour'
FROM (VALUES ('staff_sql_cashier'), ('staff_sql_auditfail')) fixture(actor_id);

SET ROLE anon;
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_cashier', 'disabled', NULL, 'staff_sql_owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') $$, '42501', NULL, 'anonymous cannot invoke staff status mutation');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT pos_admin_set_control_membership('org_staff_guard', 'staff_sql_cashier', 'admin', 'active', 'staff_sql_owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2') $$, '42501', NULL, 'authenticated browser cannot invoke role mutation');
RESET ROLE;
SET ROLE service_role;

SELECT throws_ok($$ SELECT pos_admin_set_control_membership('org_staff_guard', 'staff_sql_new_owner', 'owner', 'active', 'staff_sql_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3') $$, '42501', NULL, 'admin cannot grant active owner authority');
SELECT throws_ok($$ SELECT pos_admin_set_control_membership('org_staff_guard', 'staff_sql_owner', 'admin', 'active', 'staff_sql_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4') $$, '42501', NULL, 'admin cannot change active owner authority');
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_other', 'staff_sql_cashier', 'disabled', NULL, 'staff_sql_owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5') $$, '42501', NULL, 'caller from another organization has no authority');
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_admin', 'disabled', NULL, 'staff_sql_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6') $$, '42501', NULL, 'admin cannot deactivate own management access');
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_owner', 'disabled', NULL, 'staff_sql_owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7') $$, '42501', NULL, 'owner cannot deactivate own management access');
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_owner', 'disabled', NULL, 'staff_sql_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8') $$, '42501', NULL, 'current owner cannot be deactivated by admin');
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_disabled_owner', 'active', NULL, 'staff_sql_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9') $$, '42501', NULL, 'admin cannot restore a current owner');
SELECT throws_ok($$ SELECT pos_admin_set_control_membership('org_staff_guard', 'staff_sql_owner', 'admin', 'active', 'staff_sql_owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10') $$, '23514', NULL, 'POS-disabled fallback owner does not allow last usable owner demotion');

INSERT INTO pos_staff_access_controls (organization_id, actor_id, status, updated_by_actor_id)
VALUES ('org_staff_guard', 'staff_sql_stale', 'disabled', 'staff_sql_owner');
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_cashier', 'disabled', NULL, 'staff_sql_stale', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11') $$, '42501', NULL, 'current disabled caller cannot rely on earlier BFF authorization');
SELECT throws_ok($$ SELECT pos_admin_set_control_membership('org_staff_guard', 'staff_sql_cashier', 'admin', 'active', 'staff_sql_stale', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12') $$, '42501', NULL, 'current disabled caller cannot grant a role');
UPDATE pos_staff_access_controls SET status = 'active' WHERE organization_id = 'org_staff_guard' AND actor_id = 'staff_sql_stale';
UPDATE pos_organization_memberships SET control_role = 'support' WHERE organization_id = 'org_staff_guard' AND actor_id = 'staff_sql_stale';
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_cashier', 'disabled', NULL, 'staff_sql_stale', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13') $$, '42501', NULL, 'current demoted caller cannot rely on earlier BFF authorization');

SELECT lives_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_staged', 'disabled', 'Synthetic staged provisioning', 'staff_sql_owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14') $$, 'staged account may begin with disabled POS access');
SELECT lives_ok($$ SELECT pos_admin_set_control_membership('org_staff_guard', 'staff_sql_staged', 'owner', 'active', 'staff_sql_owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15') $$, 'owner may grant staged account owner membership');
SELECT lives_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_staged', 'active', NULL, 'staff_sql_owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa16') $$, 'owner may finish staged owner activation');
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_staged', 'disabled', NULL, 'staff_sql_owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa17') $$, '42501', NULL, 'owner grant followed by disable cannot strand the new owner');

SELECT lives_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_cashier', 'disabled', 'Synthetic deactivation', 'staff_sql_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa18') $$, 'admin can deactivate ordinary staff');
SELECT is((SELECT status FROM pos_staff_access_controls WHERE organization_id = 'org_staff_guard' AND actor_id = 'staff_sql_cashier'), 'disabled', 'deactivation commits POS disabled status');
SELECT is((SELECT count(*)::integer FROM pos_staff_sessions WHERE organization_id = 'org_staff_guard' AND actor_id = 'staff_sql_cashier' AND revoked_at IS NOT NULL), 1, 'deactivation revokes the existing POS session');
SELECT is((SELECT role FROM pos_staff_location_assignments WHERE organization_id = 'org_staff_guard' AND actor_id = 'staff_sql_cashier'), 'cashier', 'deactivation preserves historical location assignment');
SELECT is((SELECT count(*)::integer FROM pos_admin_audit_events WHERE organization_id = 'org_staff_guard' AND target_id = 'staff_sql_cashier' AND action = 'staff.access_status.set'), 1, 'deactivation produces one audit event');
SELECT lives_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_cashier', 'active', NULL, 'staff_sql_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa19') $$, 'admin can reactivate ordinary staff');
SELECT is((SELECT count(*)::integer FROM pos_staff_sessions WHERE organization_id = 'org_staff_guard' AND actor_id = 'staff_sql_cashier' AND revoked_at IS NOT NULL), 1, 'reactivation never restores a previously revoked session');
RESET ROLE;

CREATE FUNCTION pg_temp.staff_guard_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id = 'org_staff_guard' AND NEW.target_id = 'staff_sql_auditfail' THEN
    RAISE EXCEPTION 'synthetic staff audit failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER synthetic_staff_audit_failure BEFORE INSERT ON pos_admin_audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.staff_guard_reject_audit();
SET ROLE service_role;
SELECT throws_ok($$ SELECT pos_admin_set_staff_access_status('org_staff_guard', 'staff_sql_auditfail', 'disabled', NULL, 'staff_sql_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20') $$, 'P0001', 'synthetic staff audit failure', 'audit failure aborts deactivation');
SELECT is((SELECT count(*)::integer FROM pos_staff_access_controls WHERE organization_id = 'org_staff_guard' AND actor_id = 'staff_sql_auditfail'), 0, 'audit failure rolls back the access status insert');
SELECT is((SELECT count(*)::integer FROM pos_staff_sessions WHERE organization_id = 'org_staff_guard' AND actor_id = 'staff_sql_auditfail' AND revoked_at IS NULL), 1, 'audit failure rolls back session revocation');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
