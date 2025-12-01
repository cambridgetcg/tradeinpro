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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 25;

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
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    search,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
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
  const { prices, total, page, totalPages, search } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAddForm, setShowAddForm] = useState(false);

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(
        fetcher.data.action === "created"
          ? "Card price added"
          : fetcher.data.action === "updated"
            ? "Price updated"
            : fetcher.data.action === "deleted"
              ? "Card deleted"
              : "Status toggled"
      );
      if (fetcher.data.action === "created") {
        setShowAddForm(false);
      }
    }
  }, [fetcher.data, shopify]);

  const formatPrice = (cents: number) => (cents / 100).toFixed(2);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const searchInput = form.elements.namedItem("search") as HTMLInputElement;
    setSearchParams({ search: searchInput.value, page: "1" });
  };

  return (
    <s-page heading="Card Prices">
      <s-button slot="primary-action" onClick={() => setShowAddForm(!showAddForm)}>
        {showAddForm ? "Cancel" : "Add Card"}
      </s-button>

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
                  <s-text-field label="NM Price ($)" name="priceNM" />
                  <s-text-field label="LP Price ($)" name="priceLP" />
                  <s-text-field label="MP Price ($)" name="priceMP" />
                  <s-text-field label="HP Price ($)" name="priceHP" />
                  <s-text-field label="DMG Price ($)" name="priceDMG" />
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
              label="Search cards"
              name="search"
              defaultValue={search}
              placeholder="Card name, set name, or set code..."
            />
            <s-button type="submit">Search</s-button>
            {search && (
              <s-button
                variant="tertiary"
                onClick={() => setSearchParams({ page: "1" })}
              >
                Clear
              </s-button>
            )}
          </s-stack>
        </form>
      </s-section>

      {/* Results count */}
      <s-box paddingBlock="base">
        <s-text tone="subdued">
          {total} cards found
          {search && ` for "${search}"`}
        </s-text>
      </s-box>

      {/* Prices list */}
      {prices.length === 0 ? (
        <s-section>
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>No card prices yet</strong>
              </s-text>
              <s-paragraph>
                Add card prices to allow customers to submit trade-ins.
              </s-paragraph>
              <s-button onClick={() => setShowAddForm(true)}>
                Add First Card
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
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
                  <s-text tone="subdued">NM: ${formatPrice(price.priceNM)}</s-text>
                  <s-text tone="subdued">LP: ${formatPrice(price.priceLP)}</s-text>
                  <s-text tone="subdued">MP: ${formatPrice(price.priceMP)}</s-text>
                  <s-text tone="subdued">HP: ${formatPrice(price.priceHP)}</s-text>
                  <s-text tone="subdued">DMG: ${formatPrice(price.priceDMG)}</s-text>
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
      {totalPages > 1 && (
        <s-box paddingBlock="large">
          <s-stack direction="inline" gap="base">
            <s-button
              variant="tertiary"
              disabled={page <= 1}
              onClick={() =>
                setSearchParams({ search, page: String(page - 1) })
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
                setSearchParams({ search, page: String(page + 1) })
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
