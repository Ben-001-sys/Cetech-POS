-- MANAGE-REMEDIATION-01 additive proposal. Root migration editor allocates filename.
-- One configuration owner: same table, NULL location represents organization scope.
ALTER TABLE public.pos_receipt_settings DROP CONSTRAINT pos_receipt_settings_pkey;
ALTER TABLE public.pos_receipt_settings ALTER COLUMN location_id DROP NOT NULL;
ALTER TABLE public.pos_receipt_settings ADD CONSTRAINT pos_receipt_settings_scope_unique UNIQUE NULLS NOT DISTINCT (organization_id, location_id);
ALTER TABLE public.pos_receipt_settings ADD COLUMN settings_override jsonb;
COMMENT ON COLUMN public.pos_receipt_settings.settings_override IS 'NULL preserves legacy full local settings. An object is an explicit sparse override; {} inherits all shared fields. Null logo suppresses the shared logo.';

CREATE FUNCTION public.pos_receipt_settings_override_is_valid(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE field record; presentation jsonb; number_value numeric;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  FOR field IN SELECT key,val FROM jsonb_each(value) AS fields(key,val) LOOP
    IF field.key IN ('shortenProductNames','showSku') THEN
      IF jsonb_typeof(field.val) <> 'boolean' THEN RETURN false; END IF;
    ELSIF field.key = 'productNameMaxCharacters' THEN
      IF jsonb_typeof(field.val) <> 'number' THEN RETURN false; END IF;
      number_value := (field.val #>> '{}')::numeric;
      IF number_value < 1 OR number_value > 256 OR trunc(number_value) <> number_value THEN RETURN false; END IF;
    ELSIF field.key = 'presentation' THEN
      IF jsonb_typeof(field.val) <> 'object' OR field.val ? 'templateVersion' THEN RETURN false; END IF;
      presentation := field.val;
      IF presentation->'logoDataUrl' = 'null'::jsonb THEN presentation := presentation - 'logoDataUrl'; END IF;
      IF NOT public.pos_receipt_presentation_is_valid(presentation || '{"templateVersion":1}'::jsonb) THEN RETURN false; END IF;
    ELSE RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_receipt_settings_override_is_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_receipt_settings_override_is_valid(jsonb) TO service_role;
ALTER TABLE public.pos_receipt_settings ADD CONSTRAINT pos_receipt_settings_override_check CHECK (public.pos_receipt_settings_override_is_valid(settings_override) AND (location_id IS NOT NULL OR settings_override IS NULL));

CREATE FUNCTION public.pos_admin_set_receipt_settings_scope(
  p_organization_id text, p_location_id text, p_actor_id text, p_correlation_id uuid,
  p_settings jsonb DEFAULT NULL, p_override jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE existing public.pos_receipt_settings%ROWTYPE; saved public.pos_receipt_settings%ROWTYPE; before_json jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_actor_id IS NULL OR p_correlation_id IS NULL THEN RAISE EXCEPTION 'organization, actor and correlation are required' USING ERRCODE='23502'; END IF;
  -- The same organization row serializes shared/override/bulk writes, including absent scopes.
  PERFORM 1 FROM public.pos_organizations WHERE id=p_organization_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization is missing' USING ERRCODE='23503'; END IF;
  IF p_location_id IS NULL THEN
    IF p_override IS NOT NULL OR p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object'
      OR NOT (p_settings ?& ARRAY['shortenProductNames','productNameMaxCharacters','showSku'])
      OR NOT public.pos_receipt_settings_override_is_valid(p_settings - 'presentation')
      OR (p_settings ? 'presentation' AND NOT public.pos_receipt_presentation_is_valid(p_settings->'presentation'))
    THEN RAISE EXCEPTION 'shared receipt settings are invalid' USING ERRCODE='23514'; END IF;
  ELSE
    IF p_settings IS NOT NULL OR p_override IS NULL OR NOT public.pos_receipt_settings_override_is_valid(p_override) THEN RAISE EXCEPTION 'receipt override is invalid' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.pos_locations WHERE id=p_location_id AND organization_id=p_organization_id) THEN RAISE EXCEPTION 'location is outside organization' USING ERRCODE='23503'; END IF;
  END IF;
  SELECT * INTO existing FROM public.pos_receipt_settings WHERE organization_id=p_organization_id AND location_id IS NOT DISTINCT FROM p_location_id FOR UPDATE;
  IF FOUND THEN before_json := to_jsonb(existing); END IF;
  IF p_location_id IS NULL THEN
    INSERT INTO public.pos_receipt_settings(organization_id,location_id,shorten_product_names,product_name_max_characters,show_sku,presentation)
    VALUES(p_organization_id,NULL,(p_settings->>'shortenProductNames')::boolean,((p_settings->>'productNameMaxCharacters')::numeric)::integer,(p_settings->>'showSku')::boolean,p_settings->'presentation')
    ON CONFLICT(organization_id,location_id) DO UPDATE SET shorten_product_names=EXCLUDED.shorten_product_names,product_name_max_characters=EXCLUDED.product_name_max_characters,show_sku=EXCLUDED.show_sku,presentation=EXCLUDED.presentation,settings_override=NULL,updated_at=now() RETURNING * INTO saved;
  ELSE
    INSERT INTO public.pos_receipt_settings(organization_id,location_id,settings_override) VALUES(p_organization_id,p_location_id,p_override)
    ON CONFLICT(organization_id,location_id) DO UPDATE SET settings_override=EXCLUDED.settings_override,updated_at=now() RETURNING * INTO saved;
  END IF;
  INSERT INTO public.pos_admin_audit_events(organization_id,actor_id,action,target_type,target_id,location_id,before_state,after_state,correlation_id)
  VALUES(p_organization_id,p_actor_id,CASE WHEN p_location_id IS NULL THEN 'receipt_settings.shared.set' ELSE 'receipt_settings.set' END,'receipt_settings',COALESCE(p_location_id,p_organization_id),p_location_id,before_json,to_jsonb(saved),p_correlation_id);
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.pos_admin_set_receipt_settings_scope(text,text,text,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_set_receipt_settings_scope(text,text,text,uuid,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.pos_admin_apply_shared_receipt_settings(p_organization_id text,p_actor_id text,p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE loc record; existing public.pos_receipt_settings%ROWTYPE; saved public.pos_receipt_settings%ROWTYPE; kept jsonb; source jsonb; before_json jsonb; affected integer:=0;
BEGIN
  IF p_organization_id IS NULL OR p_actor_id IS NULL OR p_correlation_id IS NULL THEN RAISE EXCEPTION 'organization, actor and correlation are required' USING ERRCODE='23502'; END IF;
  PERFORM 1 FROM public.pos_organizations WHERE id=p_organization_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization is missing' USING ERRCODE='23503'; END IF;
  FOR loc IN SELECT id FROM public.pos_locations WHERE organization_id=p_organization_id ORDER BY id LOOP
    before_json:=NULL;
    SELECT * INTO existing FROM public.pos_receipt_settings WHERE organization_id=p_organization_id AND location_id=loc.id FOR UPDATE;
    IF FOUND THEN before_json:=to_jsonb(existing); END IF;
    -- Keep only EXPLICIT local details, never copy inherited details into overrides.
    source:=CASE WHEN existing.settings_override IS NOT NULL THEN existing.settings_override->'presentation' ELSE existing.presentation END;
    SELECT COALESCE(jsonb_object_agg(key,val),'{}'::jsonb) INTO kept FROM jsonb_each(COALESCE(source,'{}'::jsonb)) AS fields(key,val) WHERE key IN ('address','contactPhone','taxRegistrationNumber');
    INSERT INTO public.pos_receipt_settings(organization_id,location_id,settings_override)
    VALUES(p_organization_id,loc.id,CASE WHEN kept='{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('presentation',kept) END)
    ON CONFLICT(organization_id,location_id) DO UPDATE SET settings_override=EXCLUDED.settings_override,updated_at=now() RETURNING * INTO saved;
    INSERT INTO public.pos_admin_audit_events(organization_id,actor_id,action,target_type,target_id,location_id,before_state,after_state,correlation_id)
    VALUES(p_organization_id,p_actor_id,'receipt_settings.inherit_layout','receipt_settings',loc.id,loc.id,before_json,to_jsonb(saved),p_correlation_id);
    affected:=affected+1;
  END LOOP;
  RETURN jsonb_build_object('affectedLocationCount',affected);
END;
$$;
REVOKE ALL ON FUNCTION public.pos_admin_apply_shared_receipt_settings(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_apply_shared_receipt_settings(text,text,uuid) TO service_role;

-- Preserve legacy callers: a full local save becomes a full local override.
CREATE OR REPLACE FUNCTION public.pos_admin_set_receipt_settings(
  p_organization_id text,
  p_location_id text,
  p_actor_id text,
  p_correlation_id uuid,
  p_shorten_product_names boolean,
  p_product_name_max_characters integer,
  p_show_sku boolean,
  p_presentation jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing public.pos_receipt_settings%ROWTYPE;
  saved public.pos_receipt_settings%ROWTYPE;
  before_json jsonb;
  after_json jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_location_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'organization, location, and actor are required' USING ERRCODE = '23502';
  END IF;
  IF p_shorten_product_names IS NULL OR p_show_sku IS NULL THEN
    RAISE EXCEPTION 'receipt presentation choices are required' USING ERRCODE = '23502';
  END IF;
  IF p_product_name_max_characters IS NULL
     OR p_product_name_max_characters < 1
     OR p_product_name_max_characters > 256 THEN
    RAISE EXCEPTION 'product name max characters must be from 1 to 256' USING ERRCODE = '23514';
  END IF;
  IF NOT public.pos_receipt_presentation_is_valid(p_presentation) THEN
    RAISE EXCEPTION 'receipt presentation is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.pos_locations
    WHERE id = p_location_id
      AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'location is outside the organization' USING ERRCODE = '23503';
  END IF;

  PERFORM 1 FROM public.pos_organizations WHERE id = p_organization_id FOR NO KEY UPDATE;

  SELECT *
  INTO existing
  FROM public.pos_receipt_settings
  WHERE organization_id = p_organization_id
    AND location_id = p_location_id
  FOR UPDATE;

  IF FOUND THEN
    before_json := to_jsonb(existing);
    UPDATE public.pos_receipt_settings
    SET shorten_product_names = p_shorten_product_names,
        product_name_max_characters = p_product_name_max_characters,
        show_sku = p_show_sku,
        presentation = COALESCE(p_presentation, existing.presentation),
        settings_override = CASE WHEN p_presentation IS NULL AND existing.settings_override IS NOT NULL THEN existing.settings_override || jsonb_build_object('shortenProductNames',p_shorten_product_names,'productNameMaxCharacters',p_product_name_max_characters,'showSku',p_show_sku) ELSE NULL END,
        updated_at = now()
    WHERE organization_id = p_organization_id
      AND location_id = p_location_id
    RETURNING * INTO saved;
  ELSE
    before_json := NULL;
    INSERT INTO public.pos_receipt_settings (
      organization_id,
      location_id,
      shorten_product_names,
      product_name_max_characters,
      show_sku,
      presentation,
      settings_override
    ) VALUES (
      p_organization_id,
      p_location_id,
      p_shorten_product_names,
      p_product_name_max_characters,
      p_show_sku,
      p_presentation,
      CASE WHEN p_presentation IS NULL AND EXISTS(SELECT 1 FROM public.pos_receipt_settings WHERE organization_id=p_organization_id AND location_id IS NULL) THEN jsonb_build_object('shortenProductNames',p_shorten_product_names,'productNameMaxCharacters',p_product_name_max_characters,'showSku',p_show_sku) ELSE NULL END
    )
    RETURNING * INTO saved;
  END IF;

  after_json := to_jsonb(saved);

  INSERT INTO public.pos_admin_audit_events (
    organization_id,
    actor_id,
    action,
    target_type,
    target_id,
    location_id,
    before_state,
    after_state,
    correlation_id
  ) VALUES (
    p_organization_id,
    p_actor_id,
    'receipt_settings.set',
    'receipt_settings',
    p_location_id,
    p_location_id,
    before_json,
    after_json,
    p_correlation_id
  );

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'locationId', saved.location_id,
    'shortenProductNames', saved.shorten_product_names,
    'productNameMaxCharacters', saved.product_name_max_characters,
    'showSku', saved.show_sku,
    'presentation', saved.presentation
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.pos_admin_set_receipt_settings(
  text, text, text, uuid, boolean, integer, boolean, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pos_admin_set_receipt_settings(
  text, text, text, uuid, boolean, integer, boolean, jsonb
) TO service_role;

COMMENT ON FUNCTION public.pos_admin_set_receipt_settings(
  text, text, text, uuid, boolean, integer, boolean, jsonb
) IS
  'Atomic trusted-server receipt-settings upsert plus append-only admin audit. Business authorization is required in the BFF before service_role invocation. Optional presentation preserves old callers and never rewrites historical receipts.';
