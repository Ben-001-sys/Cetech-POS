import type { PosRestFetch } from "../http/server-fetch";

export type ManagementDevice = {
  readonly id: string;
  readonly label: string;
  readonly status: "active" | "inactive";
};

export type ManagementRegister = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly status: "active" | "disabled" | "maintenance";
};

export type ManagementLocation = {
  readonly id: string;
  readonly name: string;
  readonly status?: "active" | "inactive";
  readonly registers: readonly ManagementRegister[];
  readonly devices: readonly ManagementDevice[];
};

export type SavedLocation = {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "inactive";
};

export type SavedRegister = {
  readonly id: string;
  readonly locationId: string;
  readonly name: string;
  readonly currency: string;
  readonly status: "active" | "disabled" | "maintenance";
};

export type SavedDevice = {
  readonly id: string;
  readonly locationId: string;
  readonly label: string;
  readonly status: "active" | "inactive";
};

export type TopologyMutationFailure = "invalid" | "outside" | "unavailable" | "busy" | "inactive-parent";

export type TopologyMutation = SavedLocation | SavedRegister | SavedDevice | TopologyMutationFailure;

export interface ManagementTopologyDirectory {
  listOrganization(input: {
    readonly organizationId: string;
  }): Promise<readonly ManagementLocation[] | "unavailable">;
  saveLocation(input: {
    readonly organizationId: string;
    readonly actorId: string;
    readonly correlationId: string;
    readonly locationId?: string;
    readonly name: string;
    readonly status: "active" | "inactive";
  }): Promise<SavedLocation | TopologyMutationFailure>;
  saveRegister(input: {
    readonly organizationId: string;
    readonly actorId: string;
    readonly correlationId: string;
    readonly registerId?: string;
    readonly locationId: string;
    readonly name: string;
    readonly currency?: string;
    readonly status: "active" | "disabled" | "maintenance";
  }): Promise<SavedRegister | TopologyMutationFailure>;
  saveDevice(input: {
    readonly organizationId: string;
    readonly actorId: string;
    readonly correlationId: string;
    readonly deviceId?: string;
    readonly locationId: string;
    readonly label: string;
    readonly status: "active" | "inactive";
  }): Promise<SavedDevice | TopologyMutationFailure>;
}

export function createMemoryManagementTopologyDirectory(
  rows: readonly ManagementLocation[] = [],
): ManagementTopologyDirectory {
  const state = rows.map((row) => ({
    ...row,
    status: row.status ?? "active" as const,
    registers: row.registers.map((register) => ({ ...register })),
    devices: row.devices.map((device) => ({ ...device })),
  }));
  return {
    async listOrganization() {
      return state.map((row) => ({
        ...row,
        registers: row.registers.map((register) => ({ ...register })),
        devices: row.devices.map((device) => ({ ...device })),
      }));
    },
    async saveLocation(input) {
      const name = input.name.trim();
      if (name.length < 1 || name.length > 128) return "invalid";
      if (input.status !== "active" && input.status !== "inactive") return "invalid";
      if (input.locationId) {
        const current = state.find((row) => row.id === input.locationId);
        if (!current) return "outside";
        current.name = name;
        current.status = input.status;
        return { id: current.id, name: current.name, status: current.status };
      }
      const id = `loc_${state.length + 1}`;
      state.push({ id, name, status: input.status, registers: [], devices: [] });
      return { id, name, status: input.status };
    },
    async saveRegister(input) {
      const name = input.name.trim();
      const location = state.find((row) => row.id === input.locationId);
      if (!location) return "outside";
      if (name.length < 1 || name.length > 128) return "invalid";
      if (input.registerId) {
        const current = location.registers.find((row) => row.id === input.registerId);
        if (!current) return "outside";
        if (input.currency && input.currency !== current.currency) return "invalid";
        if (input.status === "active" && current.status !== "active" && location.status === "inactive") return "inactive-parent";
        current.name = name;
        current.status = input.status;
        return {
          id: current.id,
          locationId: location.id,
          name: current.name,
          currency: current.currency,
          status: current.status,
        };
      }
      if (input.status === "active" && location.status === "inactive") return "inactive-parent";
      const currency = input.currency?.trim().toUpperCase();
      if (!currency || !/^[A-Z]{3}$/.test(currency)) return "invalid";
      const id = `reg_${location.registers.length + 1}`;
      const saved = { id, name, currency, status: input.status };
      location.registers.push(saved);
      return { ...saved, locationId: location.id };
    },
    async saveDevice(input) {
      const label = input.label.trim();
      const location = state.find((row) => row.id === input.locationId);
      if (!location) return "outside";
      if (label.length < 1 || label.length > 128) return "invalid";
      if (input.deviceId) {
        const currentLocation = state.find((row) => row.devices.some((device) => device.id === input.deviceId));
        const current = currentLocation?.devices.find((device) => device.id === input.deviceId);
        if (!current || !currentLocation) return "outside";
        if (input.status === "active" && (current.status !== "active" || currentLocation.id !== location.id) && location.status === "inactive") return "inactive-parent";
        currentLocation.devices = currentLocation.devices.filter((device) => device.id !== current.id);
        const saved = { id: current.id, label, status: input.status };
        location.devices.push(saved);
        return { ...saved, locationId: location.id };
      }
      if (input.status === "active" && location.status === "inactive") return "inactive-parent";
      const id = `device-${location.devices.length + 1}`;
      const saved = { id, label, status: input.status };
      location.devices.push(saved);
      return { ...saved, locationId: location.id };
    },
  };
}

export function createSupabaseManagementTopologyDirectory(input: {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl: PosRestFetch;
  readonly timeoutMs?: number;
}): ManagementTopologyDirectory {
  const root = `${input.url.replace(/\/+$/, "")}/rest/v1`;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const headers = {
    apikey: input.serviceRoleKey,
    Authorization: `Bearer ${input.serviceRoleKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function get(path: string): Promise<unknown | "unavailable"> {
    try {
      const response = await input.fetchImpl(`${root}/${path}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return "unavailable";
      return await response.json();
    } catch {
      return "unavailable";
    }
  }

  return {
    async listOrganization({ organizationId }) {
      const [locationsBody, registersBody, devicesBody] = await Promise.all([
        get(`pos_locations?organization_id=eq.${encodeURIComponent(organizationId)}&select=id,name,status&order=name.asc`),
        get(`pos_registers?organization_id=eq.${encodeURIComponent(organizationId)}&select=id,location_id,name,currency,status&order=name.asc`),
        get(`pos_devices?organization_id=eq.${encodeURIComponent(organizationId)}&select=id,location_id,label,status&order=label.asc`),
      ]);
      if (
        locationsBody === "unavailable" ||
        registersBody === "unavailable" ||
        devicesBody === "unavailable" ||
        !Array.isArray(locationsBody) ||
        !Array.isArray(registersBody) ||
        !Array.isArray(devicesBody)
      ) {
        return "unavailable";
      }

      return locationsBody.flatMap((row) => {
        if (!record(row) || typeof row.id !== "string" || typeof row.name !== "string") {
          return [];
        }
        const locationId = row.id;
        const devices = devicesBody.flatMap((device) => {
          if (
            !record(device) ||
            device.location_id !== locationId ||
            typeof device.id !== "string" ||
            typeof device.label !== "string" ||
            (device.status !== "active" && device.status !== "inactive")
          ) {
            return [];
          }
          return [{
            id: device.id,
            label: device.label,
            status: device.status,
          } satisfies ManagementDevice];
        });

        const registers = registersBody.flatMap((register) => {
          if (
            !record(register) ||
            register.location_id !== locationId ||
            typeof register.id !== "string" ||
            typeof register.name !== "string" ||
            typeof register.currency !== "string" ||
            !["active", "disabled", "maintenance"].includes(String(register.status))
          ) {
            return [];
          }
          return [{
            id: register.id,
            name: register.name,
            currency: register.currency,
            status: register.status as ManagementRegister["status"],
          } satisfies ManagementRegister];
        });

        const status = row.status === "inactive" ? "inactive" : row.status === "active" || row.status == null ? "active" : undefined;
        if (!status) return [];
        return [{
          id: locationId,
          name: row.name,
          status,
          registers,
          devices,
        } satisfies ManagementLocation];
      });
    },
    async saveLocation(input) {
      const body = await post("rpc/pos_admin_save_location", {
        p_organization_id: input.organizationId,
        p_location_id: input.locationId ?? null,
        p_name: input.name,
        p_status: input.status,
        p_actor_id: input.actorId,
        p_correlation_id: input.correlationId,
      });
      return savedLocation(body);
    },
    async saveRegister(input) {
      const body = await post("rpc/pos_admin_save_register", {
        p_organization_id: input.organizationId,
        p_register_id: input.registerId ?? null,
        p_location_id: input.locationId,
        p_name: input.name,
        p_currency: input.currency ?? null,
        p_status: input.status,
        p_actor_id: input.actorId,
        p_correlation_id: input.correlationId,
      });
      return savedRegister(body);
    },
    async saveDevice(input) {
      const body = await post("rpc/pos_admin_save_device", {
        p_organization_id: input.organizationId,
        p_device_id: input.deviceId ?? null,
        p_location_id: input.locationId,
        p_label: input.label,
        p_status: input.status,
        p_actor_id: input.actorId,
        p_correlation_id: input.correlationId,
      });
      return savedDevice(body);
    },
  };

  async function post(path: string, body: unknown): Promise<unknown | "unavailable" | "invalid" | "outside"> {
    try {
      const response = await input.fetchImpl(`${root}/${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const result = await response.json();
      if (!response.ok) {
        if (record(result) && result.code === "55000") return "busy";
        if (record(result) && result.code === "23514" && result.message === "parent location is inactive") return "inactive-parent";
        if (record(result) && result.code === "23503") return "outside";
        if (response.status === 400) return "invalid";
        if (response.status === 409) return "outside";
        return "unavailable";
      }
      return result;
    } catch {
      return "unavailable";
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function savedLocation(body: unknown): SavedLocation | TopologyMutationFailure {
  if (body === "invalid" || body === "outside" || body === "unavailable" || body === "busy" || body === "inactive-parent") return body;
  if (!record(body) || typeof body.id !== "string" || typeof body.name !== "string") return "unavailable";
  if (body.status !== "active" && body.status !== "inactive") return "unavailable";
  return { id: body.id, name: body.name, status: body.status };
}

function savedRegister(body: unknown): SavedRegister | TopologyMutationFailure {
  if (body === "invalid" || body === "outside" || body === "unavailable" || body === "busy" || body === "inactive-parent") return body;
  if (
    !record(body) ||
    typeof body.id !== "string" ||
    typeof body.locationId !== "string" ||
    typeof body.name !== "string" ||
    typeof body.currency !== "string" ||
    (body.status !== "active" && body.status !== "disabled" && body.status !== "maintenance")
  ) {
    return "unavailable";
  }
  return {
    id: body.id,
    locationId: body.locationId,
    name: body.name,
    currency: body.currency.trim(),
    status: body.status,
  };
}

function savedDevice(body: unknown): SavedDevice | TopologyMutationFailure {
  if (body === "invalid" || body === "outside" || body === "unavailable" || body === "busy" || body === "inactive-parent") return body;
  if (
    !record(body) ||
    typeof body.id !== "string" ||
    typeof body.locationId !== "string" ||
    typeof body.label !== "string" ||
    (body.status !== "active" && body.status !== "inactive")
  ) {
    return "unavailable";
  }
  return { id: body.id, locationId: body.locationId, label: body.label, status: body.status };
}
