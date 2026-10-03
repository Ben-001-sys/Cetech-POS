BEGIN;
SELECT plan(23);

SET ROLE anon;
SELECT throws_ok($$ SELECT public.pos_admin_set_receipt_settings(
  'org_a', 'loc_a1', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false, 40, false,
  '{"templateVersion":1,"businessName":"CETECH Tema"}'::jsonb
) $$, '42501', NULL, 'anonymous cannot invoke the extended settings RPC');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT public.pos_admin_set_receipt_settings(
  'org_a', 'loc_a1', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false, 40, false,
  '{"templateVersion":1}'::jsonb
) $$, '42501', NULL, 'authenticated cannot invoke the extended settings RPC');
RESET ROLE;

SET ROLE service_role;
SELECT lives_ok($$ SELECT public.pos_admin_set_receipt_settings(
  'org_a', 'loc_a1', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false, 40, false,
  '{"templateVersion":1,"businessName":"CETECH Tema","logoDataUrl":"data:image/png;base64,iVBORw0KGgo=","showCustomerPhone":false}'::jsonb
) $$, 'trusted server saves bounded embedded presentation through the audited RPC');
SELECT is((SELECT presentation->>'businessName' FROM public.pos_receipt_settings
  WHERE organization_id='org_a' AND location_id='loc_a1'), 'CETECH Tema', 'business name persists');
SELECT is((SELECT after_state->'presentation'->>'businessName' FROM public.pos_admin_audit_events
  WHERE action='receipt_settings.set' AND location_id='loc_a1'), 'CETECH Tema', 'audit freezes presentation in after state');
SELECT lives_ok($$ SELECT public.pos_admin_set_receipt_settings(
  'org_a', 'loc_a1', 'owner_a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true, 18, true
) $$, 'old seven-argument caller remains valid without an overloaded RPC');
SELECT is((SELECT presentation->>'businessName' FROM public.pos_receipt_settings
  WHERE organization_id='org_a' AND location_id='loc_a1'), 'CETECH Tema', 'omitted presentation preserves existing branding');
SELECT lives_ok($$ SELECT public.pos_admin_set_receipt_settings(
  'org_a', 'loc_a1', 'owner_a', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', false, 40, false, NULL
) $$, 'explicit SQL null presentation preserves old caller compatibility');
SELECT is((SELECT presentation->>'businessName' FROM public.pos_receipt_settings
  WHERE organization_id='org_a' AND location_id='loc_a1'), 'CETECH Tema', 'explicit null preserves existing branding');
SELECT throws_ok($$ SELECT public.pos_admin_set_receipt_settings(
  'org_a', 'loc_b1', 'owner_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false, 40, false,
  '{"templateVersion":1}'::jsonb
) $$, '23503', NULL, 'presentation cannot escape organization scope');

-- Reject mismatched types, unknown keys and unsafe/oversized external or non-raster logos.
SELECT throws_ok(format($test$ UPDATE public.pos_receipt_settings SET presentation=%L::jsonb
  WHERE organization_id='org_a' AND location_id='loc_a1' $test$, bad::text), '23514', NULL, description)
FROM (VALUES
  ('{"templateVersion":2}'::jsonb, 'unknown template version is rejected'),
  ('{"templateVersion":1,"extra":true}'::jsonb, 'unknown presentation keys are rejected'),
  ('{"templateVersion":1,"showCashier":"yes"}'::jsonb, 'presentation flags must be boolean'),
  ('{"templateVersion":1,"logoDataUrl":"https://example.test/logo.png"}'::jsonb, 'external logo is rejected'),
  ('{"templateVersion":1,"logoDataUrl":"data:image/svg+xml;base64,YQ=="}'::jsonb, 'SVG logo is rejected'),
  ('{"templateVersion":1,"logoDataUrl":"data:image/png;base64,YQ=="}'::jsonb, 'non-raster signature is rejected'),
  (jsonb_build_object('templateVersion',1,'businessName',repeat('x',81)), 'business-name bound is enforced'),
  (jsonb_build_object('templateVersion',1,'logoDataUrl','data:image/png;base64,iVBORw0KGgo'||repeat('A',131072)), 'logo-size bound is enforced'),
  ('null'::jsonb, 'JSON null is not a valid supplied presentation')
) invalid(bad, description);
SELECT is((SELECT presentation->>'businessName' FROM public.pos_receipt_settings
  WHERE organization_id='org_a' AND location_id='loc_a1'), 'CETECH Tema', 'invalid writes preserve saved presentation');
RESET ROLE;

CREATE FUNCTION public.pos_test_fail_receipt_presentation_audit()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.action='receipt_settings.set' AND NEW.correlation_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid THEN
    RAISE EXCEPTION 'audit failure' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pos_test_fail_receipt_presentation_audit BEFORE INSERT ON public.pos_admin_audit_events
FOR EACH ROW EXECUTE FUNCTION public.pos_test_fail_receipt_presentation_audit();
SET ROLE service_role;
SELECT throws_ok($$ SELECT public.pos_admin_set_receipt_settings(
  'org_a', 'loc_a1', 'owner_a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', false, 40, false,
  '{"templateVersion":1,"businessName":"Changed after audit failure"}'::jsonb
) $$, 'P0001', NULL, 'audit failure aborts presentation mutation');
SELECT is((SELECT presentation->>'businessName' FROM public.pos_receipt_settings
  WHERE organization_id='org_a' AND location_id='loc_a1'), 'CETECH Tema', 'audit failure leaves presentation unchanged');
SELECT is((SELECT count(*)::int FROM public.pos_admin_audit_events
  WHERE correlation_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid), 0, 'audit failure leaves no misleading event');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
