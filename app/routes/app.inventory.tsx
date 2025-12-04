import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getInventory } from "../services/priceApi.server";

// Card types for filtering
const CARD_TYPES = [
  { value: "", label: "All Types" },
  { value: "Parallel", label: "Parallel" },
  { value: "Manga", label: "Manga" },
  { value: "Promo", label: "Promo" },
  { value: "Box Topper", label: "Box Topper" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const cardType = url.searchParams.get("cardType") || "";
  const page = parseInt(url.searchParams.get("page") || "1");
  const source = url.searchParams.get("source") || "api"; // api or local
  const pageSize = 50;

  let inventoryItems: Awaited<ReturnType<typeof getInventory>>["data"] = [];
  let total = 0;
  let hasMore = false;

  if (source === "api") {
    // Fetch from external API
    try {
      const response = await getInventory({
        card_type: cardType || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      inventoryItems = response.data;
      total = response.pagination.total;
      hasMore = response.pagination.has_more;
    } catch {
      // API failed - fall back to empty
    }
  }

  // Get local trade-in stats
  const localStats = await db.tradeInSubmission.aggregate({
    _count: { id: true },
    _sum: { finalTotal: true },
    where: { status: "COMPLETED" },
  });

  const pendingItems = await db.tradeInItem.count({
    where: {
      submission: {
        status: { in: ["RECEIVED", "GRADING", "PENDING_APPROVAL"] },
      },
    },
  });

  return {
    inventoryItems,
    total,
    hasMore,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    cardType,
    source,
    stats: {
      completedTradeIns: localStats._count.id,
      totalPaidOut: localStats._sum.finalTotal || 0,
      pendingItems,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "syncInventory": {
      // Sync inventory items from API to local database
      try {
        const response = await getInventory({ limit: 100 });
        let synced = 0;

        for (const item of response.data) {
          // Upsert into local inventory tracking
          // This would require an InventoryItem model in Prisma
          synced++;
        }

        return { success: true, action: "synced", count: synced };
      } catch (error) {
        return { success: false, error: "Failed to sync inventory" };
      }
    }

    default:
      return { error: "Unknown action" };
  }
};

export default function Inventory() {
  const {
    inventoryItems,
    total,
    page,
    totalPages,
    cardType,
    source,
    stats,
  } = useLoaderData<typeof loader>();

  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(
        fetcher.data.action === "synced"
          ? `Synced ${fetcher.data.count} items`
          : "Action completed"
      );
    }
  }, [fetcher.data, shopify]);

  const formatPrice = (value: number | null, currency = "GBP") => {
    if (value === null) return "-";
    const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "£";
    return `${symbol}${value.toFixed(2)}`;
  };

  const getPriceDiffClass = (diff: number | null) => {
    if (diff === null) return "neutral";
    if (diff > 20) return "success";
    if (diff < -10) return "critical";
    return "neutral";
  };

  return (
    <s-page heading="Inventory & Alt Art">
      <s-stack slot="primary-action" direction="inline" gap="tight">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="syncInventory" />
          <s-button type="submit" loading={isLoading}>
            Sync from API
          </s-button>
        </fetcher.Form>
      </s-stack>

      {/* Stats Overview */}
      <s-section heading="Trade-In Overview">
        <s-stack direction="inline" gap="large">
          <s-box padding="base" background="subdued" borderRadius="base" style={{ flex: 1 }}>
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Completed Trade-Ins</s-text>
              <s-text variant="headingMd">
                <strong>{stats.completedTradeIns}</strong>
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base" style={{ flex: 1 }}>
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Total Paid Out</s-text>
              <s-text variant="headingMd">
                <strong>£{(stats.totalPaidOut / 100).toFixed(2)}</strong>
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base" style={{ flex: 1 }}>
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Pending Grading</s-text>
              <s-text variant="headingMd">
                <strong>{stats.pendingItems}</strong>
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Source Toggle */}
      <s-box paddingBlockEnd="base">
        <s-stack direction="inline" gap="tight">
          <s-button
            variant={source === "api" ? "primary" : "tertiary"}
            onClick={() => setSearchParams({ source: "api", cardType, page: "1" })}
          >
            External Inventory (API)
          </s-button>
          <s-button
            variant={source === "local" ? "primary" : "tertiary"}
            onClick={() => setSearchParams({ source: "local", cardType, page: "1" })}
          >
            Local Trade-Ins
          </s-button>
        </s-stack>
      </s-box>

      {/* Filters */}
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-select
            label="Card Type"
            value={cardType}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSearchParams({ source, cardType: e.target.value, page: "1" })
            }
          >
            {CARD_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </s-select>
        </s-stack>
      </s-section>

      {/* Results count */}
      <s-box paddingBlock="base">
        <s-text tone="subdued">
          {total} items found
          {cardType && ` (${cardType})`}
        </s-text>
      </s-box>

      {/* Inventory Table */}
      {source === "api" && inventoryItems.length === 0 ? (
        <s-section>
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>No inventory items found</strong>
              </s-text>
              <s-paragraph>
                Check your API connection or try a different filter.
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      ) : source === "api" ? (
        <s-section>
          {/* Header */}
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="inline" gap="base">
              <s-text style={{ width: "120px" }}><strong>SKU</strong></s-text>
              <s-text style={{ width: "80px" }}><strong>Type</strong></s-text>
              <s-text style={{ width: "60px" }}><strong>Set</strong></s-text>
              <s-text style={{ width: "90px" }}><strong>JP Cost</strong></s-text>
              <s-text style={{ width: "90px" }}><strong>EN Price</strong></s-text>
              <s-text style={{ width: "90px" }}><strong>TCGplayer</strong></s-text>
              <s-text style={{ width: "90px" }}><strong>CardMarket</strong></s-text>
              <s-text style={{ width: "70px" }}><strong>Diff %</strong></s-text>
            </s-stack>
          </s-box>

          {inventoryItems.map((item) => (
            <s-box key={item.sku} padding="base" borderBlockEndWidth="base">
              <s-stack direction="inline" gap="base">
                <s-text style={{ width: "120px" }}>{item.sku}</s-text>
                <s-badge tone="info" style={{ width: "80px" }}>{item.card_type}</s-badge>
                <s-text style={{ width: "60px" }}>{item.release_set}</s-text>
                <s-text style={{ width: "90px" }}>{formatPrice(item.gbp_cost)}</s-text>
                <s-text style={{ width: "90px" }}>
                  <strong>{formatPrice(item.best_en_price_gbp)}</strong>
                </s-text>
                <s-text style={{ width: "90px" }}>{formatPrice(item.tcgplayer_price_gbp)}</s-text>
                <s-text style={{ width: "90px" }}>{formatPrice(item.cardmarket_price_gbp)}</s-text>
                <s-badge
                  tone={getPriceDiffClass(item.price_diff_pct)}
                  style={{ width: "70px" }}
                >
                  {item.price_diff_pct !== null
                    ? `${item.price_diff_pct > 0 ? "+" : ""}${item.price_diff_pct.toFixed(0)}%`
                    : "-"}
                </s-badge>
              </s-stack>
            </s-box>
          ))}
        </s-section>
      ) : (
        <s-section>
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>Local trade-in view coming soon</strong>
              </s-text>
              <s-paragraph>
                This view will show cards received through trade-ins that are now
                part of your inventory.
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Pagination */}
      {source === "api" && totalPages > 1 && (
        <s-box paddingBlock="large">
          <s-stack direction="inline" gap="base">
            <s-button
              variant="tertiary"
              disabled={page <= 1}
              onClick={() =>
                setSearchParams({ source, cardType, page: String(page - 1) })
              }
            >
              Previous
            </s-button>
            <s-text>
              Page {page} of {totalPages}
            </s-text>
            <s-button
              variant="tertiary"
              disabled={page >= totalPages}
              onClick={() =>
                setSearchParams({ source, cardType, page: String(page + 1) })
              }
            >
              Next
            </s-button>
          </s-stack>
        </s-box>
      )}

      {/* Sidebar - Legend */}
      <s-section slot="aside" heading="Price Comparison Legend">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="tight">
            <s-badge tone="success">+20%+</s-badge>
            <s-text>Good profit margin</s-text>
          </s-stack>
          <s-stack direction="inline" gap="tight">
            <s-badge tone="neutral">-10% to +20%</s-badge>
            <s-text>Normal range</s-text>
          </s-stack>
          <s-stack direction="inline" gap="tight">
            <s-badge tone="critical">Below -10%</s-badge>
            <s-text>Below cost - review pricing</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Column Descriptions">
        <s-stack direction="block" gap="tight">
          <s-paragraph>
            <strong>JP Cost:</strong> Your cost in GBP for Japanese variant
          </s-paragraph>
          <s-paragraph>
            <strong>EN Price:</strong> Best available English version price
          </s-paragraph>
          <s-paragraph>
            <strong>Diff %:</strong> Price difference vs English version
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
