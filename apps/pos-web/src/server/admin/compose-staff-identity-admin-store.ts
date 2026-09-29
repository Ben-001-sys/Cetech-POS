import { readSupabaseInfrastructureEnv } from "../../config/env";
import { isDeployedInvitationEnvironment } from "./invitation-redirect";
import { createServerRestFetch } from "../http/server-fetch";
import {
  createMemoryStaffIdentityAdminStore,
  createSupabaseStaffIdentityAdminStore,
  type StaffIdentityAdminStore,
} from "./staff-identity-admin-store";

export function composeStaffIdentityAdminStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
): StaffIdentityAdminStore {
  const infrastructure = readSupabaseInfrastructureEnv(env);
  const appEnv = env.APP_ENV ?? "local";
  if (infrastructure) {
    return createSupabaseStaffIdentityAdminStore({
      url: infrastructure.url,
      serviceRoleKey: infrastructure.serviceRoleKey,
      fetchImpl: createServerRestFetch(),
      allowLocalhostInvitationRedirect: !isDeployedInvitationEnvironment(env),
    });
  }
  if (appEnv === "staging" || appEnv === "production") {
    throw new Error("durable staff identity admin store is required");
  }
  return createMemoryStaffIdentityAdminStore();
}
