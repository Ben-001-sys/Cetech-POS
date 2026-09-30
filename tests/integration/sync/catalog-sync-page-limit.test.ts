import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "vitest";
import type { ApiResult } from "../../../docs/contracts/ports";
import type { CatalogSyncPage } from "../../../apps/pos-web/src/core/catalog/sync-page";
import { mapBridgeCatalogItem } from "../../../apps/pos-web/src/server/catalog/map-bridge-catalog";
import { createLocalCatalogPort } from "../../../apps/pos-web/src/local/catalog-repository";
import { CATALOG_SYNC_REQUEST_TIMEOUT_MS } from "../../../apps/pos-web/src/local/catalog-sync-client";
import {
  CATALOG_SYNC_PAGE_LIMIT,
  ensureCatalogProjection,
} from "../../../apps/pos-web/src/local/catalog-sync";
import {
  deletePosLocalDatabase,
  openPosLocalDatabase,
} from "../../../apps/pos-web/src/local/pos-local-db";

const DBS: string[] = [];
const CORRELATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function uniqueDb() {
  const name = `cetech-pos-local-${crypto.randomUUID()}`;
  DBS.push(name);
  return openPosLocalDatabase(name);
}

afterEach(async () => {
  await Promise.all(DBS.splice(0).map((name) => deletePosLocalDatabase(name)));
});

function record(sourceItemId: string, name: string) {
  const mapped = mapBridgeCatalogItem({
    sourceSystem: "woocommerce",
    sourceItemId,
    sourceVersion: `2026-09-30T12:00:00.000Z:${sourceItemId}`,
    name,
    sku: `SKU-${sourceItemId}`,
    barcodes: [`BAR-${sourceItemId}`],
    kind: "simple",
    purchasable: true,
    stockStatus: "in_stock",
    sourceUpdatedAt: "2026-09-30T12:00:00.000Z",
    deleted: false,
  });
  if (!mapped) {
    throw new Error("catalog test record did not map");
  }
  return mapped;
}

function successPage(
  items: CatalogSyncPage["items"],
  nextCursor: string | null = null,
): ApiResult<CatalogSyncPage> {
  return {
    ok: true,
    correlationId: CORRELATION,
    data: {
      policy: "provider_required",
      sourceSystem: "woocommerce",
      items,
      nextCursor,
    },
  };
}

function unavailable(): ApiResult<CatalogSyncPage> {
  return {
    ok: false,
    correlationId: CORRELATION,
    error: {
      code: "INTEGRATION_UNAVAILABLE",
      message: "catalog producer is unavailable",
      retryable: true,
      nextAction: "resolve",
    },
  };
}

describe("catalog producer page sizing", () => {
  test("requests 25-item pages with a bounded 20-second client deadline and does not publish an incomplete forced rebuild", async () => {
    const db = uniqueDb();
    await ensureCatalogProjection({
      db,
      policy: "provider_required",
      force: true,
      fetchPage: async () => successPage([record("100", "Previous product")]),
    });

    const queries: Array<{ cursor?: string; limit?: number }> = [];
    const result = await ensureCatalogProjection({
      db,
      policy: "provider_required",
      force: true,
      fetchPage: async (query) => {
        queries.push({ cursor: query.cursor, limit: query.limit });
        if (!query.cursor) {
          return successPage([record("200", "Incomplete replacement")], "200");
        }
        return unavailable();
      },
    });

    expect(CATALOG_SYNC_PAGE_LIMIT).toBe(25);
    expect(CATALOG_SYNC_REQUEST_TIMEOUT_MS).toBe(20_000);
    expect(queries).toEqual([
      { cursor: undefined, limit: 25 },
      { cursor: "200", limit: 25 },
    ]);
    expect(result.availability).toBe("stale");
    expect(result.itemCount).toBe(1);
    expect(result.fetchedPages).toBe(2);

    const catalog = createLocalCatalogPort({ db, correlationId: () => CORRELATION });
    const previous = await catalog.search({ query: "Previous product" });
    const incomplete = await catalog.search({ query: "Incomplete replacement" });
    expect(previous.ok && previous.data.items).toHaveLength(1);
    expect(incomplete.ok && incomplete.data.items).toEqual([]);
  });
});
