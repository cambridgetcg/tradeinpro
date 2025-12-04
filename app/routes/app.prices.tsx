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
import {
  getTradeInPrices,
  searchPrices,
  convertToDbFormat,
  type TradeInPrice,
} from "../services/priceApi.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const page = parseInt(url.searchParams.get("page") || "1");
  const source = url.searchParams.get("source") || "local"; // 'local' or 'api'
  const pageSize = 25;

  // If viewing API data, fetch from external API
  if (source === "api" && search) {
    try {
      const apiResults = await searchPrices({
        query: search,
        game: "onepiece",
        limit: 50,
      });

      return {
        prices: [],
        apiPrices: apiResults.data,
        total: apiResults.count,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        search,
        source,
        error: null,
      };
    } catch (error) {
      return {
        prices: [],
        apiPrices: [],
        total: 0,
        page: 1,
        pageSize,
        totalPages: 0,
        search,
        source,
        error: "Failed to fetch from API",
      };
    }
  }

  // Default: fetch from local database
  const where = search
    ? {
        OR: [
          { cardName: { contains: search } },
          { setName: { contains: search } },
          { setCode: { contains: search } },
        ],
      }
    : {};

  const [prices, total] = await Promise.all([
    db.cardPrice.findMany({
      where,
      orderBy: [{ setName: "asc" }, { cardName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.cardPrice.count({ where }),
  ]);

  return {
    prices,
    apiPrices: [],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    search,
    source,
    error: null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "syncFromApi": {
      // Sync trade-in prices from external API
      const game = formData.get("game") as string || "onepiece";

      try {
        const apiResponse = await getTradeInPrices({
          game,
          currency: "GBP",
        });

        let synced = 0;
        let errors = 0;

        for (const apiPrice of apiResponse.data) {
          try {
            const dbData = convertToDbFormat(apiPrice);

            // Upsert by card name + set + variant
            await db.cardPrice.upsert({
              where: {
                id: `${dbData.cardName}-${dbData.setName}-${dbData.variant || 'base'}`,
              },
              create: {
                ...dbData,
                isActive: true,
              },
              update: {
                priceNM: dbData.priceNM,
                priceLP: dbData.priceLP,
                priceMP: dbData.priceMP,
                priceHP: dbData.priceHP,
                priceDMG: dbData.priceDMG,
              },
            });
            synced++;
          } catch {
            // If unique constraint fails, try create with generated ID
            try {
              const dbData = convertToDbFormat(apiPrice);
              await db.cardPrice.create({
                data: {
                  ...dbData,
                  isActive: true,
                },
              });
              synced++;
            } catch {
              errors++;
            }
          }
        }

        return {
          success: true,
          action: "synced",
          synced,
          errors,
          total: apiResponse.count,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        };
      }
    }

    case "importCard": {
      // Import a single card from API search results
      const cardData = JSON.parse(formData.get("cardData") as string) as TradeInPrice;
      const dbData = convertToDbFormat(cardData);

      try {
        await db.cardPrice.create({
          data: {
            ...dbData,
            isActive: true,
          },
        });
        return { success: true, action: "imported" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Import failed",
        };
      }
    }

    case "create": {
      const cardName = formData.get("cardName") as string;
      const setName = formData.get("setName") as string;
      const setCode = formData.get("setCode") as string;
      const rarity = formData.get("rarity") as string;
      const variant = formData.get("variant") as string;
      const priceNM = Math.round(parseFloat(formData.get("priceNM") as string || "0") * 100);
      const priceLP = Math.round(parseFloat(formData.get("priceLP") as string || "0") * 100);
      const priceMP = Math.round(parseFloat(formData.get("priceMP") as string || "0") * 100);
      const priceHP = Math.round(parseFloat(formData.get("priceHP") as string || "0") * 100);
      const priceDMG = Math.round(parseFloat(formData.get("priceDMG") as string || "0") * 100);

      await db.cardPrice.create({
        data: {
          cardName,
          setName,
          setCode: setCode || null,
          rarity: rarity || null,
          variant: variant || null,
          priceNM,
          priceLP,
          priceMP,
          priceHP,
          priceDMG,
        },
      });

      return { success: true, action: "created" };
    }

    case "update": {
      const id = formData.get("id") as string;
      const priceNM = Math.round(parseFloat(formData.get("priceNM") as string || "0") * 100);
      const priceLP = Math.round(parseFloat(formData.get("priceLP") as string || "0") * 100);
      const priceMP = Math.round(parseFloat(formData.get("priceMP") as string || "0") * 100);
      const priceHP = Math.round(parseFloat(formData.get("priceHP") as string || "0") * 100);
      const priceDMG = Math.round(parseFloat(formData.get("priceDMG") as string || "0") * 100);
      const isActive = formData.get("isActive") === "true";

      await db.cardPrice.update({
        where: { id },
        data: { priceNM, priceLP, priceMP, priceHP, priceDMG, isActive },
      });

      return { success: true, action: "updated" };
    }

    case "delete": {
      const id = formData.get("id") as string;
      await db.cardPrice.delete({ where: { id } });
      return { success: true, action: "deleted" };
    }

    case "toggleActive": {
      const id = formData.get("id") as string;
      const price = await db.cardPrice.findUnique({ where: { id } });
      if (price) {
        await db.cardPrice.update({
          where: { id },
          data: { isActive: !price.isActive },
        });
      }
      return { success: true, action: "toggled" };
    }

    default:
      return { error: "Unknown action" };
  }
};

export default function Prices() {
  const { prices, apiPrices, total, page, totalPages, search, source, error } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAddForm, setShowAddForm] = useState(false);

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      const msg =
        fetcher.data.action === "created"
          ? "Card price added"
          : fetcher.data.action === "updated"
            ? "Price updated"
            : fetcher.data.action === "deleted"
              ? "Card deleted"
              : fetcher.data.action === "toggled"
                ? "Status toggled"
                : fetcher.data.action === "synced"
                  ? `Synced ${fetcher.data.synced} prices from API`
                  : fetcher.data.action === "imported"
                    ? "Card imported from API"
                    : "Action completed";
      shopify.toast.show(msg);
      if (fetcher.data.action === "created") {
        setShowAddForm(false);
      }
    } else if (fetcher.data && !fetcher.data.success && fetcher.data.error) {
      shopify.toast.show(`Error: ${fetcher.data.error}`, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const formatPrice = (cents: number) => (cents / 100).toFixed(2);
  const formatApiPrice = (price: number | null) => price?.toFixed(2) || "0.00";

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const searchInput = form.elements.namedItem("search") as HTMLInputElement;
    setSearchParams({ search: searchInput.value, page: "1", source });
  };

  const handleSync = () => {
    fetcher.submit(
      { intent: "syncFromApi", game: "onepiece" },
      { method: "post" }
    );
  };

  const handleImportCard = (cardData: TradeInPrice) => {
    fetcher.submit(
      { intent: "importCard", cardData: JSON.stringify(cardData) },
      { method: "post" }
    );
  };

  return (
    <s-page heading="Card Prices">
      <s-button slot="primary-action" onClick={() => setShowAddForm(!showAddForm)}>
        {showAddForm ? "Cancel" : "Add Card"}
      </s-button>

      {/* Sync from API */}
      <s-section>
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack direction="inline" gap="base">
            <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
              <s-text>
                <strong>External Price API</strong>
              </s-text>
              <s-text tone="subdued">
                Sync trade-in prices from TCGplayer and CardMarket
              </s-text>
            </s-stack>
            <s-button onClick={handleSync} loading={isLoading}>
              Sync Prices
            </s-button>
          </s-stack>
        </s-box>
      </s-section>

      {/* Source toggle */}
      <s-box paddingBlockEnd="base">
        <s-stack direction="inline" gap="tight">
          <s-button
            variant={source === "local" ? "primary" : "tertiary"}
            onClick={() => setSearchParams({ search, page: "1", source: "local" })}
          >
            Local Database
          </s-button>
          <s-button
            variant={source === "api" ? "primary" : "tertiary"}
            onClick={() => setSearchParams({ search, page: "1", source: "api" })}
          >
            Search API
          </s-button>
        </s-stack>
      </s-box>

      {/* Add form */}
      {showAddForm && (
        <s-section>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-box paddingBlockEnd="base">
              <s-text>
                <strong>Add New Card Price</strong>
              </s-text>
            </s-box>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="create" />
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base">
                  <s-text-field label="Card Name" name="cardName" required />
                  <s-text-field label="Set Name" name="setName" required />
                  <s-text-field label="Set Code" name="setCode" />
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-text-field label="Rarity" name="rarity" />
                  <s-text-field label="Variant" name="variant" placeholder="e.g. Holo, Reverse" />
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-text-field label="NM Price (£)" name="priceNM" />
                  <s-text-field label="LP Price (£)" name="priceLP" />
                  <s-text-field label="MP Price (£)" name="priceMP" />
                  <s-text-field label="HP Price (£)" name="priceHP" />
                  <s-text-field label="DMG Price (£)" name="priceDMG" />
                </s-stack>
                <s-button type="submit" variant="primary" loading={isLoading}>
                  Add Card
                </s-button>
              </s-stack>
            </fetcher.Form>
          </s-box>
        </s-section>
      )}

      {/* Search */}
      <s-section>
        <form onSubmit={handleSearch}>
          <s-stack direction="inline" gap="base">
            <s-text-field
              label={source === "api" ? "Search API" : "Search local cards"}
              name="search"
              defaultValue={search}
              placeholder={source === "api" ? "Search One Piece cards..." : "Card name, set name, or set code..."}
            />
            <s-button type="submit">Search</s-button>
            {search && (
              <s-button
                variant="tertiary"
                onClick={() => setSearchParams({ page: "1", source })}
              >
                Clear
              </s-button>
            )}
          </s-stack>
        </form>
      </s-section>

      {/* Error message */}
      {error && (
        <s-box padding="base" background="critical" borderRadius="base">
          <s-text tone="critical">{error}</s-text>
        </s-box>
      )}

      {/* Results count */}
      <s-box paddingBlock="base">
        <s-text tone="subdued">
          {total} cards found
          {search && ` for "${search}"`}
          {source === "api" && " (from API)"}
        </s-text>
      </s-box>

      {/* API Results */}
      {source === "api" && apiPrices.length > 0 && (
        <s-section>
          {apiPrices.map((price, index) => (
            <s-box
              key={`${price.card_id}-${index}`}
              padding="base"
              borderBlockEndWidth="base"
            >
              <s-stack direction="inline" gap="large">
                <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                  <s-text>
                    <strong>{price.name}</strong>
                    {price.rarity && <span> ({price.rarity})</span>}
                  </s-text>
                  <s-text tone="subdued">
                    {price.card_id}
                    {price.variant_type && ` - ${price.variant_type}`}
                  </s-text>
                  <s-text tone="subdued">
                    Source: {price.source}
                  </s-text>
                </s-stack>
                <s-stack direction="block" gap="tight">
                  <s-text>
                    Market: £{formatApiPrice(price.market_price_gbp)}
                  </s-text>
                  {price.tcgplayer_price_usd && (
                    <s-text tone="subdued">
                      TCGplayer: ${formatApiPrice(price.tcgplayer_price_usd)}
                    </s-text>
                  )}
                  {price.cardmarket_price_eur && (
                    <s-text tone="subdued">
                      CardMarket: €{formatApiPrice(price.cardmarket_price_eur)}
                    </s-text>
                  )}
                </s-stack>
                <s-button
                  variant="tertiary"
                  onClick={() => handleImportCard(price as unknown as TradeInPrice)}
                  loading={isLoading}
                >
                  Import
                </s-button>
              </s-stack>
            </s-box>
          ))}
        </s-section>
      )}

      {/* Local Prices list */}
      {source === "local" && prices.length === 0 ? (
        <s-section>
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>No card prices yet</strong>
              </s-text>
              <s-paragraph>
                Add card prices to allow customers to submit trade-ins, or sync from the external API.
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button onClick={() => setShowAddForm(true)}>
                  Add First Card
                </s-button>
                <s-button variant="tertiary" onClick={handleSync}>
                  Sync from API
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
      ) : source === "local" && (
        <s-section>
          {prices.map((price) => (
            <s-box
              key={price.id}
              padding="base"
              borderBlockEndWidth="base"
            >
              <s-stack direction="inline" gap="large">
                <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                  <s-text>
                    <strong>{price.cardName}</strong>
                    {price.rarity && <span> ({price.rarity})</span>}
                  </s-text>
                  <s-text tone="subdued">
                    {price.setName}
                    {price.setCode && ` [${price.setCode}]`}
                    {price.variant && ` - ${price.variant}`}
                  </s-text>
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-text tone="subdued">NM: £{formatPrice(price.priceNM)}</s-text>
                  <s-text tone="subdued">LP: £{formatPrice(price.priceLP)}</s-text>
                  <s-text tone="subdued">MP: £{formatPrice(price.priceMP)}</s-text>
                  <s-text tone="subdued">HP: £{formatPrice(price.priceHP)}</s-text>
                  <s-text tone="subdued">DMG: £{formatPrice(price.priceDMG)}</s-text>
                </s-stack>
                <s-badge tone={price.isActive ? "success" : "neutral"}>
                  {price.isActive ? "Active" : "Inactive"}
                </s-badge>
                <s-stack direction="inline" gap="tight">
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="toggleActive" />
                    <input type="hidden" name="id" value={price.id} />
                    <s-button variant="tertiary" type="submit">
                      {price.isActive ? "Deactivate" : "Activate"}
                    </s-button>
                  </fetcher.Form>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={price.id} />
                    <s-button variant="tertiary" tone="critical" type="submit">
                      Delete
                    </s-button>
                  </fetcher.Form>
                </s-stack>
              </s-stack>
            </s-box>
          ))}
        </s-section>
      )}

      {/* Pagination */}
      {source === "local" && totalPages > 1 && (
        <s-box paddingBlock="large">
          <s-stack direction="inline" gap="base">
            <s-button
              variant="tertiary"
              disabled={page <= 1}
              onClick={() =>
                setSearchParams({ search, page: String(page - 1), source })
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
                setSearchParams({ search, page: String(page + 1), source })
              }
            >
              Next
            </s-button>
          </s-stack>
        </s-box>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
