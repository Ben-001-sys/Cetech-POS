-- MANAGE-REMEDIATION-01 topology lifecycle proposal. Root allocates forward migration.
-- Keep historical identities and assignments. BFF Owner/Admin authorization unchanged.
-- Serialize opening versus lifecycle transition: location(s), register, device.
-- Only RPC lifecycle transitions are exposed; authenticated topology writes remain denied.

CREATE OR REPLACE FUNCTION public.pos_admin_save_location(
  p_organization_id text,
  p_location_id text,
  p_name text,
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
  v_location_id text;
  existing public.pos_locations%ROWTYPE;
  saved public.pos_locations%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_actor_id IS NULL OR p_name IS NULL THEN
    RAISE EXCEPTION 'organization, actor, and name are required' USING ERRCODE = '23502';
  END IF;
  IF char_length(btrim(p_name)) < 1 OR char_length(btrim(p_name)) > 128 THEN
    RAISE EXCEPTION 'location name is invalid' USING ERRCODE = '23514';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'location status is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pos_organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'organization was not found' USING ERRCODE = '23503';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    v_location_id := 'loc_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
  END IF;

  SELECT * INTO existing
  FROM public.pos_locations
  WHERE id = v_location_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing.organization_id <> p_organization_id THEN
      RAISE EXCEPTION 'location is outside the organization' USING ERRCODE = '23503';
    END IF;
    IF p_status = 'inactive' AND EXISTS (
      SELECT 1 FROM public.pos_shifts
      WHERE organization_id = p_organization_id AND location_id = v_location_id
        AND status IN ('open', 'closing', 'requires_attention')
    ) THEN
      RAISE EXCEPTION 'unresolved shifts prevent topology change' USING ERRCODE = '55000';
    END IF;
    UPDATE public.pos_locations
    SET name = btrim(p_name), status = p_status
    WHERE id = v_location_id
    RETURNING * INTO saved;
  ELSE
    INSERT INTO public.pos_locations (id, organization_id, name, status)
    VALUES (v_location_id, p_organization_id, btrim(p_name), p_status)
    RETURNING * INTO saved;
  END IF;

  INSERT INTO public.pos_admin_audit_events (
    organization_id, actor_id, action, target_type, target_id, location_id,
    before_state, after_state, correlation_id
  ) VALUES (
    p_organization_id, p_actor_id, 'location.save', 'location', saved.id, saved.id,
    CASE WHEN existing.id IS NULL THEN NULL ELSE to_jsonb(existing) END,
    to_jsonb(saved),
    p_correlation_id
  );

  RETURN jsonb_build_object('id', saved.id, 'name', saved.name, 'status', saved.status);
END;
$$;

REVOKE ALL ON FUNCTION public.pos_admin_save_location(text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_save_location(text, text, text, text, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pos_admin_save_register(
  p_organization_id text,
  p_register_id text,
  p_location_id text,
  p_name text,
  p_currency text,
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
  v_register_id text;
  existing public.pos_registers%ROWTYPE;
  saved public.pos_registers%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_location_id IS NULL OR p_actor_id IS NULL OR p_name IS NULL THEN
    RAISE EXCEPTION 'organization, location, actor, and name are required' USING ERRCODE = '23502';
  END IF;
  IF char_length(btrim(p_name)) < 1 OR char_length(btrim(p_name)) > 128 THEN
    RAISE EXCEPTION 'register name is invalid' USING ERRCODE = '23514';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'disabled', 'maintenance') THEN
    RAISE EXCEPTION 'register status is invalid' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.pos_locations
  WHERE id = p_location_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'location is outside the organization' USING ERRCODE = '23503';
  END IF;

  v_register_id := NULLIF(btrim(COALESCE(p_register_id, '')), '');
  IF v_register_id IS NULL THEN
    IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'register currency is required when creating a register' USING ERRCODE = '23514';
    END IF;
    IF p_status = 'active' AND EXISTS (
      SELECT 1 FROM public.pos_locations WHERE id = p_location_id AND status = 'inactive'
    ) THEN
      RAISE EXCEPTION 'parent location is inactive' USING ERRCODE = '23514';
    END IF;
    v_register_id := 'reg_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
    INSERT INTO public.pos_registers (
      id, organization_id, location_id, name, currency, status
    ) VALUES (
      v_register_id, p_organization_id, p_location_id, btrim(p_name), p_currency, p_status
    )
    RETURNING * INTO saved;
  ELSE
    SELECT * INTO existing
    FROM public.pos_registers
    WHERE id = v_register_id
    FOR UPDATE;
    IF NOT FOUND OR existing.organization_id <> p_organization_id THEN
      RAISE EXCEPTION 'register is outside the organization' USING ERRCODE = '23503';
    END IF;
    IF existing.location_id <> p_location_id THEN
      RAISE EXCEPTION 'register location cannot change after creation' USING ERRCODE = '23514';
    END IF;
    IF p_currency IS NOT NULL AND p_currency <> existing.currency THEN
      RAISE EXCEPTION 'register currency cannot change after creation' USING ERRCODE = '23514';
    END IF;
    IF p_status = 'active' AND existing.status <> 'active' AND EXISTS (
      SELECT 1 FROM public.pos_locations WHERE id = p_location_id AND status = 'inactive'
    ) THEN
      RAISE EXCEPTION 'parent location is inactive' USING ERRCODE = '23514';
    END IF;
    IF p_status <> 'active' AND EXISTS (
      SELECT 1 FROM public.pos_shifts
      WHERE organization_id = p_organization_id AND register_id = v_register_id
        AND status IN ('open', 'closing', 'requires_attention')
    ) THEN
      RAISE EXCEPTION 'unresolved shifts prevent topology change' USING ERRCODE = '55000';
    END IF;
    UPDATE public.pos_registers
    SET name = btrim(p_name), status = p_status
    WHERE id = v_register_id
    RETURNING * INTO saved;
  END IF;

  INSERT INTO public.pos_admin_audit_events (
    organization_id, actor_id, action, target_type, target_id, location_id, register_id,
    before_state, after_state, correlation_id
  ) VALUES (
    p_organization_id, p_actor_id, 'register.save', 'register', saved.id, saved.location_id, saved.id,
    CASE WHEN existing.id IS NULL THEN NULL ELSE to_jsonb(existing) END,
    to_jsonb(saved),
    p_correlation_id
  );

  RETURN jsonb_build_object(
    'id', saved.id,
    'locationId', saved.location_id,
    'name', saved.name,
    'currency', saved.currency,
    'status', saved.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_admin_save_register(text, text, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_save_register(text, text, text, text, text, text, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pos_admin_save_device(
  p_organization_id text,
  p_device_id uuid,
  p_location_id text,
  p_label text,
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
  v_device_id uuid;
  v_old_location_id text;
  existing public.pos_devices%ROWTYPE;
  saved public.pos_devices%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_location_id IS NULL OR p_actor_id IS NULL OR p_label IS NULL THEN
    RAISE EXCEPTION 'organization, location, actor, and label are required' USING ERRCODE = '23502';
  END IF;
  IF char_length(btrim(p_label)) < 1 OR char_length(btrim(p_label)) > 128 THEN
    RAISE EXCEPTION 'device label is invalid' USING ERRCODE = '23514';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'device status is invalid' USING ERRCODE = '23514';
  END IF;
  IF p_device_id IS NOT NULL THEN
    SELECT location_id INTO v_old_location_id FROM public.pos_devices
    WHERE id = p_device_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'device is outside the organization' USING ERRCODE = '23503';
    END IF;
  END IF;
  PERFORM 1 FROM public.pos_locations
  WHERE organization_id = p_organization_id AND id IN (p_location_id, v_old_location_id)
  ORDER BY id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.pos_locations
    WHERE id = p_location_id AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'location is outside the organization' USING ERRCODE = '23503';
  END IF;

  v_device_id := p_device_id;
  IF v_device_id IS NULL THEN
    IF p_status = 'active' AND EXISTS (
      SELECT 1 FROM public.pos_locations WHERE id = p_location_id AND status = 'inactive'
    ) THEN
      RAISE EXCEPTION 'parent location is inactive' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.pos_devices (organization_id, location_id, label, status)
    VALUES (p_organization_id, p_location_id, btrim(p_label), p_status)
    RETURNING * INTO saved;
  ELSE
    SELECT * INTO existing
    FROM public.pos_devices
    WHERE id = v_device_id
    FOR UPDATE;
    IF NOT FOUND OR existing.organization_id <> p_organization_id THEN
      RAISE EXCEPTION 'device is outside the organization' USING ERRCODE = '23503';
    END IF;
    IF p_status = 'active' AND (existing.status <> 'active' OR existing.location_id <> p_location_id) AND EXISTS (
      SELECT 1 FROM public.pos_locations WHERE id = p_location_id AND status = 'inactive'
    ) THEN
      RAISE EXCEPTION 'parent location is inactive' USING ERRCODE = '23514';
    END IF;
    IF existing.location_id IS DISTINCT FROM v_old_location_id THEN
      RAISE EXCEPTION 'device changed while saving; retry' USING ERRCODE = '55000';
    END IF;
    IF (p_status <> 'active' OR existing.location_id <> p_location_id) AND EXISTS (
      SELECT 1 FROM public.pos_shifts
      WHERE organization_id = p_organization_id AND device_id = v_device_id
        AND status IN ('open', 'closing', 'requires_attention')
    ) THEN
      RAISE EXCEPTION 'unresolved shifts prevent topology change' USING ERRCODE = '55000';
    END IF;
    UPDATE public.pos_devices
    SET location_id = p_location_id, label = btrim(p_label), status = p_status
    WHERE id = v_device_id
    RETURNING * INTO saved;
  END IF;

  INSERT INTO public.pos_admin_audit_events (
    organization_id, actor_id, action, target_type, target_id, location_id,
    before_state, after_state, correlation_id
  ) VALUES (
    p_organization_id, p_actor_id, 'device.save', 'device', saved.id::text, saved.location_id,
    CASE WHEN existing.id IS NULL THEN NULL ELSE to_jsonb(existing) END,
    to_jsonb(saved),
    p_correlation_id
  );

  RETURN jsonb_build_object(
    'id', saved.id,
    'locationId', saved.location_id,
    'label', saved.label,
    'status', saved.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_admin_save_device(text, uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_save_device(text, uuid, text, text, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.pos_admin_save_location(text, text, text, text, text, uuid) IS
  'Owner/Admin location create or rename/deactivate. No physical delete. BFF checks authority before service_role invocation.';
COMMENT ON FUNCTION public.pos_admin_save_register(text, text, text, text, text, text, text, uuid) IS
  'Owner/Admin register create or rename/status change. Currency and location stay fixed after creation.';
COMMENT ON FUNCTION public.pos_admin_save_device(text, uuid, text, text, text, text, uuid) IS
  'Owner/Admin device create, relabel, location reassignment, or deactivate. Devices stay location-scoped.';

-- Authenticated clients have SELECT-only topology privileges. A narrow lock helper
-- preserves those grants and the original invoker trigger's current_user checks.
-- The helper exposes no record and writes no data. It checks durable scope before
-- taking privileged row locks; only authenticated and service_role may call it.
CREATE OR REPLACE FUNCTION public.pos_lock_shift_topology(p_register_id text, p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  initial_register public.pos_registers%ROWTYPE;
  reg public.pos_registers%ROWTYPE;
  loc public.pos_locations%ROWTYPE;
  dev public.pos_devices%ROWTYPE;
BEGIN
  SELECT * INTO STRICT initial_register FROM public.pos_registers WHERE id = p_register_id;
  IF current_setting('role', true) = 'authenticated' THEN
    IF auth.uid() IS NULL OR public.pos_current_actor_id() IS NULL
       OR public.pos_current_organization_id() IS DISTINCT FROM initial_register.organization_id
       OR NOT COALESCE(initial_register.location_id = ANY (public.pos_current_location_ids()), false)
       OR NOT public.pos_has_location_assignment(initial_register.organization_id, initial_register.location_id, public.pos_current_actor_id())
       OR NOT public.pos_has_register_assignment(p_register_id, public.pos_current_actor_id())
       OR (public.pos_current_register_id() IS NOT NULL AND public.pos_current_register_id() IS DISTINCT FROM p_register_id) THEN
      RAISE EXCEPTION 'actor is not authorized' USING ERRCODE = '42501';
    END IF;
  ELSIF current_setting('role', true) NOT IN ('service_role', 'postgres', 'supabase_admin', 'none') THEN
    RAISE EXCEPTION 'actor is not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT loc FROM public.pos_locations WHERE id = initial_register.location_id FOR UPDATE;
  IF loc.status <> 'active' THEN
    RAISE EXCEPTION 'parent location is inactive' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO STRICT reg FROM public.pos_registers WHERE id = p_register_id FOR UPDATE;
  IF reg.location_id IS DISTINCT FROM loc.id OR reg.organization_id IS DISTINCT FROM loc.organization_id THEN
    RAISE EXCEPTION 'register location changed while opening shift' USING ERRCODE = '55000';
  END IF;
  IF reg.status <> 'active' THEN
    RAISE EXCEPTION 'register is not active' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO STRICT dev FROM public.pos_devices WHERE id = p_device_id FOR UPDATE;
  IF dev.status <> 'active' OR dev.organization_id <> reg.organization_id OR dev.location_id <> reg.location_id THEN
    RAISE EXCEPTION 'device is not at the register location' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_lock_shift_topology(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_lock_shift_topology(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pos_shift_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  reg pos_registers%ROWTYPE;
  dev pos_devices%ROWTYPE;
  trusted_infrastructure boolean;
BEGIN
  PERFORM public.pos_lock_shift_topology(NEW.register_id, NEW.device_id);
  SELECT * INTO STRICT reg FROM pos_registers WHERE id = NEW.register_id;
  IF reg.status <> 'active' THEN
    RAISE EXCEPTION 'register is not active' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO STRICT dev FROM pos_devices WHERE id = NEW.device_id;
  IF dev.status <> 'active'
     OR dev.organization_id <> reg.organization_id
     OR dev.location_id <> reg.location_id THEN
    RAISE EXCEPTION 'device is not at the register location' USING ERRCODE = '23514';
  END IF;
  NEW.organization_id := reg.organization_id;
  NEW.location_id := reg.location_id;
  trusted_infrastructure := current_user IN ('postgres', 'supabase_admin', 'service_role');
  IF pos_current_actor_id() IS NOT NULL THEN
    NEW.cashier_id := pos_current_actor_id();
  ELSIF NOT trusted_infrastructure OR NEW.cashier_id IS NULL THEN
    RAISE EXCEPTION 'actor is not authorized' USING ERRCODE = '42501';
  END IF;
  IF current_user = 'authenticated' THEN
    IF pos_current_organization_id() IS DISTINCT FROM NEW.organization_id
       OR NOT (NEW.location_id = ANY (pos_current_location_ids()))
       OR NOT pos_has_location_assignment(NEW.organization_id, NEW.location_id, NEW.cashier_id)
       OR NOT pos_has_register_assignment(NEW.register_id, NEW.cashier_id)
       OR (
         pos_current_register_id() IS NOT NULL
         AND pos_current_register_id() IS DISTINCT FROM NEW.register_id
       ) THEN
      RAISE EXCEPTION 'actor is not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.opening_float_currency IS NULL THEN
    NEW.opening_float_currency := reg.currency;
  END IF;
  IF NEW.opening_float_currency <> reg.currency THEN
    RAISE EXCEPTION 'opening float currency must match register' USING ERRCODE = '23514';
  END IF;
  NEW.expected_cash_minor := NEW.opening_float_minor;
  NEW.expected_cash_currency := NEW.opening_float_currency;
  NEW.status := COALESCE(NEW.status, 'open');
  IF NEW.status <> 'open' THEN
    RAISE EXCEPTION 'new shifts must open as open' USING ERRCODE = '23514';
  END IF;
  NEW.opened_at := now();
  NEW.closed_at := NULL;
  NEW.counted_cash_minor := NULL;
  NEW.counted_cash_currency := NULL;
  NEW.variance_minor := NULL;
  NEW.variance_currency := NULL;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION pos_shift_before_insert() IS
  'Opens shifts from register/device truth. Authenticated cashiers are JWT-scoped. service_role may insert only with an explicit cashier_id; that is infrastructure access, not a cashier JWT.';
