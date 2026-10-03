-- MANAGE-REMEDIATION-01 local synthetic pgTAP proposal. Root imports tests.
BEGIN;
SELECT plan(31);

SET ROLE service_role;

SELECT lives_ok($test$ INSERT INTO public.pos_shifts (register_id, device_id, opening_float_minor, opening_float_currency, cashier_id) VALUES ('reg_a', '00000000-0000-4000-8000-0000000000a1', 0, 'GHS', 'cashier_a') $test$, 'fixture opens an active shift');

SELECT throws_ok($test$ SELECT public.pos_admin_save_location('org_a', 'loc_a1', 'Location A1', 'inactive', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'open shift blocks location deactivation');

SELECT throws_ok($test$ SELECT public.pos_admin_save_register('org_a', 'reg_a', 'loc_a1', 'Register A', NULL, 'disabled', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'open shift blocks register disablement');

SELECT throws_ok($test$ SELECT public.pos_admin_save_device('org_a', '00000000-0000-4000-8000-0000000000a1', 'loc_a1', 'Device A', 'inactive', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'open shift blocks device deactivation');

SELECT throws_ok($test$ SELECT public.pos_admin_save_device('org_a', '00000000-0000-4000-8000-0000000000a1', 'loc_a2', 'Device A', 'active', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'open shift blocks device relocation');

UPDATE public.pos_shifts SET status = 'closing' WHERE register_id = 'reg_a';

SELECT throws_ok($test$ SELECT public.pos_admin_save_location('org_a', 'loc_a1', 'Location A1', 'inactive', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'closing shift blocks location deactivation');

SELECT throws_ok($test$ SELECT public.pos_admin_save_register('org_a', 'reg_a', 'loc_a1', 'Register A', NULL, 'disabled', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'closing shift blocks register disablement');

SELECT throws_ok($test$ SELECT public.pos_admin_save_device('org_a', '00000000-0000-4000-8000-0000000000a1', 'loc_a1', 'Device A', 'inactive', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'closing shift blocks device deactivation');

SELECT throws_ok($test$ SELECT public.pos_admin_save_device('org_a', '00000000-0000-4000-8000-0000000000a1', 'loc_a2', 'Device A', 'active', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'closing shift blocks device relocation');

UPDATE public.pos_shifts SET status = 'requires_attention' WHERE register_id = 'reg_a';

SELECT throws_ok($test$ SELECT public.pos_admin_save_location('org_a', 'loc_a1', 'Location A1', 'inactive', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'requires_attention shift blocks location deactivation');

SELECT throws_ok($test$ SELECT public.pos_admin_save_register('org_a', 'reg_a', 'loc_a1', 'Register A', NULL, 'disabled', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'requires_attention shift blocks register disablement');

SELECT throws_ok($test$ SELECT public.pos_admin_save_device('org_a', '00000000-0000-4000-8000-0000000000a1', 'loc_a1', 'Device A', 'inactive', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'requires_attention shift blocks device deactivation');

SELECT throws_ok($test$ SELECT public.pos_admin_save_device('org_a', '00000000-0000-4000-8000-0000000000a1', 'loc_a2', 'Device A', 'active', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '55000', NULL, 'requires_attention shift blocks device relocation');

SELECT is((SELECT count(*)::int FROM public.pos_admin_audit_events WHERE organization_id='org_a'), 0, 'blocked lifecycle changes leave no audit or partial mutation');

UPDATE public.pos_shifts SET status = 'closed', counted_cash_minor = expected_cash_minor WHERE register_id = 'reg_a';

SELECT lives_ok($test$ SELECT public.pos_admin_save_register('org_a', 'reg_a', 'loc_a1', 'Register A', NULL, 'disabled', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, 'closed-only history permits register disablement');

SELECT lives_ok($test$ SELECT public.pos_admin_save_device('org_a', '00000000-0000-4000-8000-0000000000a1', 'loc_a1', 'Device A', 'inactive', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, 'closed-only history permits device deactivation');

SELECT lives_ok($test$ SELECT public.pos_admin_save_location('org_a', 'loc_a1', 'Location A1', 'inactive', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, 'closed-only history permits location deactivation');

SELECT is((SELECT count(*)::int FROM public.pos_shifts WHERE register_id='reg_a' AND status='closed'), 1, 'closed shift history is retained');

SELECT is((SELECT count(*)::int FROM public.pos_staff_register_assignments WHERE register_id='reg_a'), 2, 'staff assignment history is retained');

SELECT is((SELECT count(*)::int FROM public.pos_admin_audit_events WHERE organization_id='org_a'), 3, 'successful lifecycle changes are audited');

SELECT throws_ok($test$ SELECT public.pos_admin_save_register('org_a', NULL, 'loc_a1', 'New register', 'GHS', 'active', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '23514', NULL, 'inactive parent rejects creation of an active register');

SELECT throws_ok($test$ SELECT public.pos_admin_save_device('org_a', NULL, 'loc_a1', 'New device', 'active', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '23514', NULL, 'inactive parent rejects creation of an active device');

SELECT throws_ok($test$ SELECT public.pos_admin_save_device('org_a', '00000000-0000-4000-8000-0000000000a1', 'loc_a1', 'Device A', 'active', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '23514', NULL, 'inactive parent rejects device reactivation');

SELECT throws_ok($test$ SELECT public.pos_admin_save_register('org_a', 'reg_a', 'loc_a1', 'Register A', NULL, 'active', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, '23514', NULL, 'inactive parent rejects register reactivation');

UPDATE public.pos_registers SET status='active' WHERE id='reg_a';
UPDATE public.pos_devices SET status='active' WHERE id='00000000-0000-4000-8000-0000000000a1';

SELECT throws_ok($test$ INSERT INTO public.pos_shifts (register_id, device_id, opening_float_minor, opening_float_currency, cashier_id) VALUES ('reg_a', '00000000-0000-4000-8000-0000000000a1', 0, 'GHS', 'cashier_a') $test$, '23514', NULL, 'new shift rejects inactive parent even when register and device are active');

SELECT lives_ok($test$ SELECT public.pos_admin_save_location('org_a', 'loc_a1', 'Location A1', 'active', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $test$, 'location can be reactivated');

SELECT lives_ok($test$ INSERT INTO public.pos_shifts (register_id, device_id, opening_float_minor, opening_float_currency, cashier_id) VALUES ('reg_a', '00000000-0000-4000-8000-0000000000a1', 0, 'GHS', 'cashier_a') $test$, 'reactivated topology can open a new shift');


UPDATE public.pos_shifts SET status='closed', counted_cash_minor=expected_cash_minor WHERE register_id='reg_a' AND status='open';
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","app_metadata":{"organization_id":"org_a","location_ids":["loc_a1"],"actor_id":"cashier_a","register_id":"reg_a"}}', true);
SET ROLE authenticated;
SELECT lives_ok($test$ INSERT INTO public.pos_shifts (register_id, device_id, opening_float_minor, opening_float_currency) VALUES ('reg_a', '00000000-0000-4000-8000-0000000000a1', 0, 'GHS') $test$, 'authenticated shift path retains SELECT-only topology grants');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","app_metadata":{"organization_id":"org_a","location_ids":["loc_a1"],"actor_id":"forged_actor","register_id":"reg_a"}}', true);
SET ROLE authenticated;
SELECT throws_ok($test$ SELECT public.pos_lock_shift_topology('reg_a', '00000000-0000-4000-8000-0000000000a1') $test$, '42501', NULL, 'lock helper denies absent durable staff assignment');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"organization_id":"org_a","location_ids":["loc_a1"],"actor_id":"cashier_a","register_id":"reg_a"}}', true);
SET ROLE authenticated;
SELECT throws_ok($test$ SELECT public.pos_lock_shift_topology('reg_a', '00000000-0000-4000-8000-0000000000a1') $test$, '42501', NULL, 'lock helper requires an authenticated subject');
RESET ROLE;
SET ROLE anon;
SELECT throws_ok($test$ SELECT public.pos_lock_shift_topology('reg_a', '00000000-0000-4000-8000-0000000000a1') $test$, '42501', NULL, 'anonymous cannot invoke lock helper');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
