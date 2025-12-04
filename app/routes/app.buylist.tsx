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
import { searchPrices } from "../services/priceApi.server";

// Games/TCGs we support
const GAMES = [
  { value: "onepiece", label: "One Piece" },
  { value: "pokemon", label: "Pokemon" },
  { value: "lorcana", label: "Lorcana" },
  { value: "mtg", label: "Magic: The Gathering" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const game = url.searchParams.get("game") || "";
  const filter = url.searchParams.get("filter") || "all"; // all, active, inactive, high-value
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 50;

  // Build filter conditions
  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { cardName: { contains: search, mode: "insensitive" } },
      { setName: { contains: search, mode: "insensitive" } },
      { setCode: { contains: search, mode: "insensitive" } },
    ];
  }

  if (filter === "active") {
    where.isActive = true;
  } else if (filter === "inactive") {
    where.isActive = false;
  } else if (filter === "high-value") {
    where.priceNM = { gte: 1000 }; // £10+
    where.isActive = true;
  }

  const [cards, total, stats] = await Promise.all([
    db.cardPrice.findMany({
      where,
      orderBy: [{ priceNM: "desc" }, { cardName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.cardPrice.count({ where }),
    db.cardPrice.aggregate({
      _count: { id: true },
      _sum: { priceNM: true },
      where: { isActive: true },
    }),
  ]);

  // If searching via API
  let apiResults: Awaited<ReturnType<typeof searchPrices>>["data"] = [];
  if (search && url.searchParams.get("source") === "api") {
    try {
      const apiResponse = await searchPrices({
        query: search,
        game: game || "onepiece",
        limit: 50,
      });
      apiResults = apiResponse.data;
    } catch {
      // Silently fail API search
    }
  }

  return {
    cards,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    search,
    game,
    filter,
    stats: {
      totalActive: stats._count.id,
      totalValue: stats._sum.priceNM || 0,
    },
    apiResults,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "toggleActive": {
      const id = formData.get("id") as string;
      const card = await db.cardPrice.findUnique({ where: { id } });
      if (card) {
        await db.cardPrice.update({
          where: { id },
          data: { isActive: !card.isActive },
        });
      }
      return { success: true, action: "toggled" };
    }

    case "bulkActivate": {
      const ids = JSON.parse(formData.get("ids") as string) as string[];
      await db.cardPrice.updateMany({
        where: { id: { in: ids } },
        data: { isActive: true },
      });
      return { success: true, action: "bulkActivated", count: ids.length };
    }

    case "bulkDeactivate": {
      const ids = JSON.parse(formData.get("ids") as string) as string[];
      await db.cardPrice.updateMany({
        where: { id: { in: ids } },
        data: { isActive: false },
      });
      return { success: true, action: "bulkDeactivated", count: ids.length };
    }

    case "updatePrices": {
      const id = formData.get("id") as string;
      const priceNM = Math.round(parseFloat(formData.get("priceNM") as string || "0") * 100);
      const priceLP = Math.round(parseFloat(formData.get("priceLP") as string || "0") * 100);
      const priceMP = Math.round(parseFloat(formData.get("priceMP") as string || "0") * 100);
      const priceHP = Math.round(parseFloat(formData.get("priceHP") as string || "0") * 100);
      const priceDMG = Math.round(parseFloat(formData.get("priceDMG") as string || "0") * 100);

      await db.cardPrice.update({
        where: { id },
        data: { priceNM, priceLP, priceMP, priceHP, priceDMG },
      });

      return { success: true, action: "pricesUpdated" };
    }

    case "applyMultiplier": {
      const multiplier = parseFloat(formData.get("multiplier") as string || "1");
      const targetFilter = formData.get("targetFilter") as string;

      const where: Record<string, unknown> = { isActive: true };
      if (targetFilter === "high-value") {
        where.priceNM = { gte: 1000 };
      }

      const cards = await db.cardPrice.findMany({ where });

      for (const card of cards) {
        await db.cardPrice.update({
          where: { id: card.id },
          data: {
            priceNM: Math.round(card.priceNM * multiplier),
            priceLP: Math.round(card.priceLP * multiplier),
            priceMP: Math.round(card.priceMP * multiplier),
            priceHP: Math.round(card.priceHP * multiplier),
            priceDMG: Math.round(card.priceDMG * multiplier),
          },
        });
      }

      return { success: true, action: "multiplierApplied", count: cards.length };
    }

    case "delete": {
      const id = formData.get("id") as string;
      await db.cardPrice.delete({ where: { id } });
      return { success: true, action: "deleted" };
    }

    default:
      return { error: "Unknown action" };
  }
};

export default function Buylist() {
  const {
    cards,
    total,
    page,
    totalPages,
    search,
    filter,
    stats,
  } = useLoaderData<typeof loader>();

  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [showMultiplierModal, setShowMultiplierModal] = useState(false);
  const [editingCard, setEditingCard] = useState<string | null>(null);

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      const msg =
        fetcher.data.action === "toggled"
          ? "Card status updated"
          : fetcher.data.action === "bulkActivated"
            ? `${fetcher.data.count} cards activated`
            : fetcher.data.action === "bulkDeactivated"
              ? `${fetcher.data.count} cards deactivated`
              : fetcher.data.action === "pricesUpdated"
                ? "Prices updated"
                : fetcher.data.action === "multiplierApplied"
                  ? `Multiplier applied to ${fetcher.data.count} cards`
                  : fetcher.data.action === "deleted"
                    ? "Card removed"
                    : "Action completed";
      shopify.toast.show(msg);
      setSelectedCards([]);
      setEditingCard(null);
    }
  }, [fetcher.data, shopify]);

  const formatPrice = (cents: number) => `£${(cents / 100).toFixed(2)}`;

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const searchInput = form.elements.namedItem("search") as HTMLInputElement;
    setSearchParams({ search: searchInput.value, filter, page: "1" });
  };

  const toggleCardSelection = (id: string) => {
    setSelectedCards((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedCards.length === cards.length) {
      setSelectedCards([]);
    } else {
      setSelectedCards(cards.map((c) => c.id));
    }
  };

  const handleBulkAction = (action: "activate" | "deactivate") => {
    fetcher.submit(
      {
        intent: action === "activate" ? "bulkActivate" : "bulkDeactivate",
        ids: JSON.stringify(selectedCards),
      },
      { method: "post" }
    );
  };

  return (
    <s-page heading="Buylist Management">
      <s-stack slot="primary-action" direction="inline" gap="tight">
        <s-button onClick={() => setShowMultiplierModal(true)}>
          Apply Multiplier
        </s-button>
      </s-stack>

      {/* Stats Bar */}
      <s-section>
        <s-stack direction="inline" gap="large">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Active Cards</s-text>
              <s-text variant="headingMd">
                <strong>{stats.totalActive}</strong>
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Total Buylist Value (NM)</s-text>
              <s-text variant="headingMd">
                <strong>{formatPrice(stats.totalValue)}</strong>
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Cards in List</s-text>
              <s-text variant="headingMd">
                <strong>{total}</strong>
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Filter Tabs */}
      <s-box paddingBlockEnd="base">
        <s-stack direction="inline" gap="tight">
          {[
            { value: "all", label: "All Cards" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "high-value", label: "High Value (£10+)" },
          ].map((f) => (
            <s-button
              key={f.value}
              variant={filter === f.value ? "primary" : "tertiary"}
              onClick={() => setSearchParams({ search, filter: f.value, page: "1" })}
            >
              {f.label}
            </s-button>
          ))}
        </s-stack>
      </s-box>

      {/* Search */}
      <s-section>
        <form onSubmit={handleSearch}>
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Search cards"
              name="search"
              defaultValue={search}
              placeholder="Card name, set, or code..."
            />
            <s-button type="submit">Search</s-button>
            {search && (
              <s-button
                variant="tertiary"
                onClick={() => setSearchParams({ filter, page: "1" })}
              >
                Clear
              </s-button>
            )}
          </s-stack>
        </form>
      </s-section>

      {/* Bulk Actions */}
      {selectedCards.length > 0 && (
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack direction="inline" gap="base">
            <s-text>
              <strong>{selectedCards.length}</strong> cards selected
            </s-text>
            <s-button variant="secondary" onClick={() => handleBulkAction("activate")}>
              Activate All
            </s-button>
            <s-button variant="secondary" onClick={() => handleBulkAction("deactivate")}>
              Deactivate All
            </s-button>
            <s-button variant="tertiary" onClick={() => setSelectedCards([])}>
              Clear Selection
            </s-button>
          </s-stack>
        </s-box>
      )}

      {/* Results count */}
      <s-box paddingBlock="base">
        <s-stack direction="inline" gap="base">
          <s-checkbox
            checked={selectedCards.length === cards.length && cards.length > 0}
            onChange={selectAll}
          >
            Select All
          </s-checkbox>
          <s-text tone="subdued">
            {total} cards found
            {search && ` for "${search}"`}
          </s-text>
        </s-stack>
      </s-box>

      {/* Cards List */}
      {cards.length === 0 ? (
        <s-section>
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>No cards found</strong>
              </s-text>
              <s-paragraph>
                Add cards to your buylist by syncing from the external price API
                or adding them manually.
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        <s-section>
          {cards.map((card) => (
            <s-box key={card.id} padding="base" borderBlockEndWidth="base">
              <s-stack direction="inline" gap="base">
                <s-checkbox
                  checked={selectedCards.includes(card.id)}
                  onChange={() => toggleCardSelection(card.id)}
                />

                <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                  <s-stack direction="inline" gap="tight">
                    <s-text>
                      <strong>{card.cardName}</strong>
                    </s-text>
                    {card.rarity && (
                      <s-badge tone="neutral">{card.rarity}</s-badge>
                    )}
                    <s-badge tone={card.isActive ? "success" : "neutral"}>
                      {card.isActive ? "Active" : "Inactive"}
                    </s-badge>
                  </s-stack>
                  <s-text tone="subdued">
                    {card.setName}
                    {card.setCode && ` [${card.setCode}]`}
                    {card.variant && ` - ${card.variant}`}
                  </s-text>
                </s-stack>

                {/* Prices - Inline or Edit Mode */}
                {editingCard === card.id ? (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="updatePrices" />
                    <input type="hidden" name="id" value={card.id} />
                    <s-stack direction="inline" gap="tight">
                      <s-text-field
                        label="NM"
                        name="priceNM"
                        defaultValue={(card.priceNM / 100).toFixed(2)}
                        style={{ width: "80px" }}
                      />
                      <s-text-field
                        label="LP"
                        name="priceLP"
                        defaultValue={(card.priceLP / 100).toFixed(2)}
                        style={{ width: "80px" }}
                      />
                      <s-text-field
                        label="MP"
                        name="priceMP"
                        defaultValue={(card.priceMP / 100).toFixed(2)}
                        style={{ width: "80px" }}
                      />
                      <s-text-field
                        label="HP"
                        name="priceHP"
                        defaultValue={(card.priceHP / 100).toFixed(2)}
                        style={{ width: "80px" }}
                      />
                      <s-text-field
                        label="DMG"
                        name="priceDMG"
                        defaultValue={(card.priceDMG / 100).toFixed(2)}
                        style={{ width: "80px" }}
                      />
                      <s-button type="submit" variant="primary" loading={isLoading}>
                        Save
                      </s-button>
                      <s-button
                        variant="tertiary"
                        onClick={() => setEditingCard(null)}
                      >
                        Cancel
                      </s-button>
                    </s-stack>
                  </fetcher.Form>
                ) : (
                  <>
                    <s-stack direction="inline" gap="base">
                      <s-stack direction="block" gap="tight">
                        <s-text tone="subdued">NM</s-text>
                        <s-text>
                          <strong>{formatPrice(card.priceNM)}</strong>
                        </s-text>
                      </s-stack>
                      <s-stack direction="block" gap="tight">
                        <s-text tone="subdued">LP</s-text>
                        <s-text>{formatPrice(card.priceLP)}</s-text>
                      </s-stack>
                      <s-stack direction="block" gap="tight">
                        <s-text tone="subdued">MP</s-text>
                        <s-text>{formatPrice(card.priceMP)}</s-text>
                      </s-stack>
                    </s-stack>

                    <s-stack direction="inline" gap="tight">
                      <s-button
                        variant="tertiary"
                        onClick={() => setEditingCard(card.id)}
                      >
                        Edit
                      </s-button>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="toggleActive" />
                        <input type="hidden" name="id" value={card.id} />
                        <s-button variant="tertiary" type="submit">
                          {card.isActive ? "Deactivate" : "Activate"}
                        </s-button>
                      </fetcher.Form>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={card.id} />
                        <s-button variant="tertiary" tone="critical" type="submit">
                          Remove
                        </s-button>
                      </fetcher.Form>
                    </s-stack>
                  </>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-section>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <s-box paddingBlock="large">
          <s-stack direction="inline" gap="base">
            <s-button
              variant="tertiary"
              disabled={page <= 1}
              onClick={() =>
                setSearchParams({ search, filter, page: String(page - 1) })
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
                setSearchParams({ search, filter, page: String(page + 1) })
              }
            >
              Next
            </s-button>
          </s-stack>
        </s-box>
      )}

      {/* Multiplier Modal */}
      {showMultiplierModal && (
        <s-box
          padding="large"
          background="subdued"
          borderRadius="base"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 1000,
            width: "400px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
          }}
        >
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="applyMultiplier" />
            <s-stack direction="block" gap="base">
              <s-text variant="headingMd">
                <strong>Apply Price Multiplier</strong>
              </s-text>
              <s-paragraph>
                Apply a multiplier to all active card prices. For example, 0.9 will
                reduce prices by 10%, and 1.1 will increase by 10%.
              </s-paragraph>
              <s-text-field
                label="Multiplier"
                name="multiplier"
                defaultValue="1.0"
                placeholder="e.g., 0.9 or 1.1"
              />
              <s-select label="Apply to" name="targetFilter" defaultValue="all">
                <option value="all">All active cards</option>
                <option value="high-value">High value cards only (£10+)</option>
              </s-select>
              <s-stack direction="inline" gap="base">
                <s-button type="submit" variant="primary" loading={isLoading}>
                  Apply
                </s-button>
                <s-button
                  variant="tertiary"
                  onClick={() => setShowMultiplierModal(false)}
                >
                  Cancel
                </s-button>
              </s-stack>
            </s-stack>
          </fetcher.Form>
        </s-box>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
