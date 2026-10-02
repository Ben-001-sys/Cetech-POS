import type { ApiResult } from "../../../../docs/contracts/ports";
import type { CatalogSourceRecord } from "../core/catalog/source";
import {
  catalogSourcePolicyAllowsSynthetic,
  type CatalogSourcePolicy,
} from "../core/catalog/source-policy";
import type { CatalogSyncPage } from "../core/catalog/sync-page";
import { applyCatalogIncremental, rebuildCatalogProjection } from "./catalog-repository";
import { ensureCashierLocalSeed } from "./cashier-seed";
import { createBrowserCatalogSyncClient } from "./catalog-sync-client";
import { openPosLocalDatabase, type PosLocalDatabase } from "./pos-local-db";
import { rebuildableCatalogClear } from "./pwa-upgrade";

export const CATALOG_SYNC_STATE_KEY = "catalog-sync-state";
export const CATALOG_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const CATALOG_SYNC_PAGE_LIMIT = 100;

export type CatalogProjectionAvailability = "fresh" | "stale" | "unavailable";

export type CatalogSyncState = {
  readonly sourceMode: "synthetic" | "provider";
  readonly syncCursor?: string | null;
  readonly modifiedAfter?: string;
  readonly lastSuccessfulSyncAt?: string;
  readonly lastAttemptAt?: string;
  readonly degraded: boolean;
  readonly availability: CatalogProjectionAvailability;
  readonly bootstrapComplete: boolean;
};

export type CatalogProjectionSyncResult = {
  readonly availability: CatalogProjectionAvailability;
  readonly sourceMode: "synthetic" | "provider" | "none";
  readonly itemCount: number;
  readonly fetchedPages: number;
  readonly usedSyntheticSeed: boolean;
  readonly producerUnavailable: boolean;
};

/** True when ensureCatalogProjection ran past the min-interval skip (IndexedDB may have changed). */
export function catalogProjectionSyncApplied(result: CatalogProjectionSyncResult): boolean {
  return result.fetchedPages > 0 || result.usedSyntheticSeed;
}

export type CatalogSyncPageFetcher = (query: {
  readonly cursor?: string;
  readonly limit?: number;
  readonly modifiedAfter?: string;
}) => Promise<ApiResult<CatalogSyncPage>>;

const SYNTHETIC_SOURCE_SYSTEMS = new Set(["transitional-commerce", ""]);

export async function readCatalogSyncState(
  db: PosLocalDatabase = openPosLocalDatabase(),
): Promise<CatalogSyncState | null> {
  const row = await db.kv.get(CATALOG_SYNC_STATE_KEY);
  if (!row?.value) {
    return null;
  }
  try {
    return JSON.parse(row.value) as CatalogSyncState;
  } catch {
    return null;
  }
}

export async function inspectLocalCatalogProjection(
  db: PosLocalDatabase = openPosLocalDatabase(),
): Promise<{
  readonly itemCount: number;
  readonly liveCount: number;
  readonly sourceSystem: string;
  readonly sourceMode: "synthetic" | "provider" | "empty";
  readonly usableFor: (policy: CatalogSourcePolicy) => boolean;
}> {
  const itemCount = await db.catalogItems.count();
  const meta = await db.catalogMeta.get("catalog");
  const liveCount = meta?.itemCount ?? 0;
  const state = await readCatalogSyncState(db);
  const sourceSystem = meta?.sourceSystem ?? "";
  const sourceMode: "synthetic" | "provider" | "empty" =
    liveCount === 0
      ? "empty"
      : state?.sourceMode === "provider" || (!SYNTHETIC_SOURCE_SYSTEMS.has(sourceSystem) && sourceSystem.length > 0)
        ? "provider"
        : "synthetic";
  return {
    itemCount,
    liveCount,
    sourceSystem,
    sourceMode,
    usableFor(policy) {
      if (liveCount === 0) {
        return false;
      }
      if (policy === "provider_required") {
        return sourceMode === "provider";
      }
      return true;
    },
  };
}

const catalogProjectionSyncInFlight = new WeakMap<
  PosLocalDatabase,
  Promise<CatalogProjectionSyncResult>
>();

export async function ensureCatalogProjection(options: {
  readonly db?: PosLocalDatabase;
  readonly policy: CatalogSourcePolicy;
  readonly fetchPage?: CatalogSyncPageFetcher;
  readonly now?: () => Date;
  readonly minRefreshIntervalMs?: number;
  readonly force?: boolean;
  readonly fetchImpl?: typeof fetch;
}): Promise<CatalogProjectionSyncResult> {
  const db = options.db ?? openPosLocalDatabase();
  const existing = catalogProjectionSyncInFlight.get(db);
  if (existing) {
    return existing;
  }
  const run = ensureCatalogProjectionUnlocked({ ...options, db });
  const tracked = run.finally(() => {
    if (catalogProjectionSyncInFlight.get(db) === tracked) {
      catalogProjectionSyncInFlight.delete(db);
    }
  });
  catalogProjectionSyncInFlight.set(db, tracked);
  return tracked;
}

async function ensureCatalogProjectionUnlocked(options: {
  readonly db: PosLocalDatabase;
  readonly policy: CatalogSourcePolicy;
  readonly fetchPage?: CatalogSyncPageFetcher;
  readonly now?: () => Date;
  readonly minRefreshIntervalMs?: number;
  readonly force?: boolean;
  readonly fetchImpl?: typeof fetch;
}): Promise<CatalogProjectionSyncResult> {
  const db = options.db;
  const now = options.now ?? (() => new Date());
  const minInterval = options.minRefreshIntervalMs ?? CATALOG_REFRESH_MIN_INTERVAL_MS;
  const inspection = await inspectLocalCatalogProjection(db);
  const previous = await readCatalogSyncState(db);
  const at = now();

  if (
    !options.force &&
    previous?.lastSuccessfulSyncAt &&
    inspection.usableFor(options.policy) &&
    at.getTime() - Date.parse(previous.lastSuccessfulSyncAt) < minInterval
  ) {
    return {
      availability: previous.availability,
      sourceMode: previous.sourceMode,
      itemCount: inspection.liveCount,
      fetchedPages: 0,
      usedSyntheticSeed: false,
      producerUnavailable: previous.degraded,
    };
  }

  if (options.policy === "provider_required" && inspection.sourceMode === "synthetic") {
    await rebuildableCatalogClear(db);
  }

  const fetchPage = options.fetchPage ?? createBrowserCatalogSyncClient({ fetchImpl: options.fetchImpl }).fetchPage;
  const providerResult = await syncFromProducer({
    db,
    fetchPage,
    now: at,
    existing: await inspectLocalCatalogProjection(db),
    force: Boolean(options.force),
  });

  if (providerResult.ok) {
    return providerResult.result;
  }

  const after = await inspectLocalCatalogProjection(db);
  if (after.usableFor(options.policy)) {
    const stale: CatalogSyncState = {
      sourceMode: after.sourceMode === "provider" ? "provider" : "synthetic",
      modifiedAfter: previous?.modifiedAfter,
      lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt,
      lastAttemptAt: at.toISOString(),
      degraded: true,
      availability: "stale",
      bootstrapComplete: true,
    };
    await writeSyncState(db, stale);
    return {
      availability: "stale",
      sourceMode: stale.sourceMode,
      itemCount: after.liveCount,
      fetchedPages: providerResult.fetchedPages,
      usedSyntheticSeed: false,
      producerUnavailable: true,
    };
  }

  if (catalogSourcePolicyAllowsSynthetic(options.policy)) {
    await ensureCashierLocalSeed(db, { policy: options.policy });
    const seeded = await inspectLocalCatalogProjection(db);
    const state: CatalogSyncState = {
      sourceMode: "synthetic",
      lastSuccessfulSyncAt: at.toISOString(),
      lastAttemptAt: at.toISOString(),
      degraded: false,
      availability: seeded.liveCount > 0 ? "fresh" : "unavailable",
      bootstrapComplete: true,
    };
    await writeSyncState(db, state);
    return {
      availability: state.availability,
      sourceMode: seeded.liveCount > 0 ? "synthetic" : "none",
      itemCount: seeded.liveCount,
      fetchedPages: providerResult.fetchedPages,
      usedSyntheticSeed: seeded.liveCount > 0,
      producerUnavailable: true,
    };
  }

  const unavailable: CatalogSyncState = {
    sourceMode: "provider",
    lastAttemptAt: at.toISOString(),
    degraded: true,
    availability: "unavailable",
    bootstrapComplete: false,
  };
  await writeSyncState(db, unavailable);
  return {
    availability: "unavailable",
    sourceMode: "none",
    itemCount: 0,
    fetchedPages: providerResult.fetchedPages,
    usedSyntheticSeed: false,
    producerUnavailable: true,
  };
}

export async function refreshCatalogProjection(
  options: Parameters<typeof ensureCatalogProjection>[0],
): Promise<CatalogProjectionSyncResult> {
  return ensureCatalogProjection(options);
}

async function syncFromProducer(input: {
  readonly db: PosLocalDatabase;
  readonly fetchPage: CatalogSyncPageFetcher;
  readonly now: Date;
  readonly existing: Awaited<ReturnType<typeof inspectLocalCatalogProjection>>;
  readonly force: boolean;
}): Promise<
  | { readonly ok: true; readonly result: CatalogProjectionSyncResult }
  | { readonly ok: false; readonly fetchedPages: number }
> {
  const existingState = await readCatalogSyncState(input.db);
  const incremental =
    !input.force &&
    input.existing.sourceMode === "provider" &&
    Boolean(existingState?.bootstrapComplete) &&
    Boolean(existingState?.modifiedAfter);
  let cursor: string | undefined;
  const modifiedAfter = incremental ? existingState?.modifiedAfter : undefined;
  let fetchedPages = 0;
  let watermark = incremental ? existingState?.modifiedAfter : undefined;
  let wrote = false;
  const bootstrapRecords: CatalogSourceRecord[] = [];
  const seenCursors = new Set<string>();

  while (true) {
    const page = await input.fetchPage({
      cursor,
      limit: CATALOG_SYNC_PAGE_LIMIT,
      modifiedAfter,
    });
    fetchedPages += 1;
    if (!page.ok) {
      return { ok: false, fetchedPages };
    }
    const records = page.data.items;
    if (records.length > 0) {
      wrote = true;
      if (incremental) {
        await applyCatalogIncremental(records, latestSourceVersion(records), input.db);
      } else {
        bootstrapRecords.push(...records);
      }
      watermark = maxTimestamp(watermark, records);
    }
    const next = page.data.nextCursor;
    if (!next) {
      if (!incremental) {
        await rebuildCatalogProjection(
          bootstrapRecords,
          latestSourceVersion(bootstrapRecords) || existingState?.modifiedAfter || "force-rebuild",
          input.db,
        );
        wrote = true;
      }
      if (!wrote && input.existing.sourceMode !== "provider") {
        return { ok: false, fetchedPages };
      }
      const after = await inspectLocalCatalogProjection(input.db);
      if (after.liveCount === 0 && after.sourceMode !== "provider") {
        return { ok: false, fetchedPages };
      }
      const state: CatalogSyncState = {
        sourceMode: "provider",
        syncCursor: null,
        modifiedAfter: watermark,
        lastSuccessfulSyncAt: input.now.toISOString(),
        lastAttemptAt: input.now.toISOString(),
        degraded: false,
        availability: after.liveCount > 0 ? "fresh" : "unavailable",
        bootstrapComplete: true,
      };
      await writeSyncState(input.db, state);
      return {
        ok: true,
        result: {
          availability: state.availability,
          sourceMode: after.liveCount > 0 ? "provider" : "none",
          itemCount: after.liveCount,
          fetchedPages,
          usedSyntheticSeed: false,
          producerUnavailable: false,
        },
      };
    }
    if (seenCursors.has(next) || next === cursor) {
      return { ok: false, fetchedPages };
    }
    seenCursors.add(next);
    cursor = next;
  }
}

async function writeSyncState(db: PosLocalDatabase, state: CatalogSyncState): Promise<void> {
  await db.kv.put({ key: CATALOG_SYNC_STATE_KEY, value: JSON.stringify(state) });
}

function latestSourceVersion(records: ReadonlyArray<CatalogSourceRecord>): string {
  return records.reduce((current, record) => (record.sourceVersion > current ? record.sourceVersion : current), records[0]?.sourceVersion ?? "");
}

function maxTimestamp(
  current: string | undefined,
  records: ReadonlyArray<CatalogSourceRecord>,
): string | undefined {
  let max = current;
  for (const record of records) {
    if (!max || record.sourceUpdatedAt > max) {
      max = record.sourceUpdatedAt;
    }
  }
  return max;
}
