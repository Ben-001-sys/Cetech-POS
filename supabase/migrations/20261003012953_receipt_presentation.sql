-- Add bounded location receipt output without rewriting historical receipt snapshots.
CREATE FUNCTION public.pos_receipt_presentation_is_valid(value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  field record;
  limit_chars integer;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' OR value->'templateVersion' IS DISTINCT FROM '1'::jsonb THEN
    RETURN false;
  END IF;
  FOR field IN SELECT key, val FROM jsonb_each(value) AS fields(key, val) LOOP
    IF field.key = 'templateVersion' THEN CONTINUE; END IF;
    IF field.key IN ('showCustomerName', 'showCustomerPhone', 'showCashier') THEN
      IF jsonb_typeof(field.val) <> 'boolean' THEN RETURN false; END IF;
    ELSIF field.key = 'logoDataUrl' THEN
      IF jsonb_typeof(field.val) <> 'string'
         OR char_length(field.val #>> '{}') > 131072
         OR (field.val #>> '{}') !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
         OR (field.val #>> '{}') !~ '^data:image/(png;base64,iVBORw0KGgo|jpeg;base64,/9j/)'
         OR char_length(split_part(field.val #>> '{}', ',', 2)) % 4 <> 0 THEN
        RETURN false;
      END IF;
    ELSIF field.key IN ('businessName', 'address', 'contactPhone', 'taxRegistrationNumber', 'footerMessage') THEN
      limit_chars := CASE field.key WHEN 'address' THEN 300 WHEN 'footerMessage' THEN 200 ELSE 80 END;
      IF jsonb_typeof(field.val) <> 'string' OR char_length(field.val #>> '{}') > limit_chars THEN
        RETURN false;
      END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_receipt_presentation_is_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_receipt_presentation_is_valid(jsonb) TO service_role;

ALTER TABLE public.pos_receipt_settings
  ADD COLUMN presentation jsonb,
  ADD CONSTRAINT pos_receipt_settings_presentation_check
    CHECK (public.pos_receipt_presentation_is_valid(presentation));
COMMENT ON COLUMN public.pos_receipt_settings.presentation IS
  'Bounded embedded receipt branding and display options. Null preserves backward-compatible settings. New receipts freeze resolved settings; no historical rewrite.';

-- Replace the former seven-argument function rather than creating a PostgREST overload.
-- Its callers remain valid through the optional eighth argument. Null/omission preserves
-- existing presentation, so an older client cannot erase branding while updating SKU settings.
DROP FUNCTION public.pos_admin_set_receipt_settings(text, text, text, uuid, boolean, integer, boolean);

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
      presentation
    ) VALUES (
      p_organization_id,
      p_location_id,
      p_shorten_product_names,
      p_product_name_max_characters,
      p_show_sku,
      p_presentation
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
