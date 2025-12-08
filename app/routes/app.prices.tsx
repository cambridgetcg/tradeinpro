import { useState, useCallback } from "react";
import type {
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import {
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Select,
  Button,
  InlineStack,
  BlockStack,
  Box,
  Pagination,
  Banner,
  Filters,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Parse search params
  const search = url.searchParams.get("search") || "";
  const releaseFilter = url.searchParams.get("release") || "";
  const setFilter = url.searchParams.get("set") || "";
  const sort = (url.searchParams.get("sort") as "name" | "card-number" | "price-asc" | "price-desc" | "updated") || "card-number";
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = 20;

  // Build where clause for CardPriceV2
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {
    game: "onepiece",
    tradeinPriceGbp: { not: null },
  };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { cardId: { contains: search, mode: "insensitive" } },
      { cardNumber: { contains: search, mode: "insensitive" } },
      { fullCardNumber: { contains: search, mode: "insensitive" } },
    ];
  }

  if (releaseFilter) {
    where.releaseSet = releaseFilter.toUpperCase();
  }

  if (setFilter) {
    where.setCode = setFilter.toUpperCase();
  }

  // Determine sort order
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any;
  switch (sort) {
    case "price-asc":
      orderBy = { tradeinPriceGbp: "asc" };
      break;
    case "price-desc":
      orderBy = { tradeinPriceGbp: "desc" };
      break;
    case "updated":
      orderBy = { lastUpdated: "desc" };
      break;
    case "name":
      orderBy = { name: "asc" };
      break;
    case "card-number":
    default:
      orderBy = [{ releaseSet: "asc" }, { fullCardNumber: "asc" }];
      break;
  }

  // Query CardPriceV2 directly
  const [prices, total, releases, sets, stats] = await Promise.all([
    prisma.cardPriceV2.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      select: {
        cardId: true,
        name: true,
        releaseSet: true,
        fullCardNumber: true,
        setCode: true,
        cardNumber: true,
        variantType: true,
        rarity: true,
        optcgTcgplayerGbp: true,
        bestPriceGbp: true,
        tradeinPriceGbp: true,
        lastUpdated: true,
      },
    }),
    prisma.cardPriceV2.count({ where }),
    prisma.cardPriceV2.groupBy({
      by: ["releaseSet"],
      where: { game: "onepiece", tradeinPriceGbp: { not: null } },
      orderBy: { releaseSet: "asc" },
    }),
    prisma.cardPriceV2.groupBy({
      by: ["setCode"],
      where: { game: "onepiece", tradeinPriceGbp: { not: null } },
      orderBy: { setCode: "asc" },
    }),
    prisma.cardPriceV2.aggregate({
      where: { game: "onepiece", tradeinPriceGbp: { not: null } },
      _count: true,
      _avg: { tradeinPriceGbp: true },
    }),
  ]);

  // Transform prices for display
  const transformedPrices = prices.map((p: typeof prices[number]) => ({
    id: p.cardId,
    releaseSet: p.releaseSet,
    fullCardNumber: p.fullCardNumber,
    setCode: p.setCode,
    cardNumber: p.cardNumber,
    name: p.name,
    variantType: p.variantType,
    rarity: p.rarity,
    optcgPrice: p.optcgTcgplayerGbp ? Number(p.optcgTcgplayerGbp) : null,
    bestPrice: p.bestPriceGbp ? Number(p.bestPriceGbp) : null,
    tradeinPrice: p.tradeinPriceGbp ? Number(p.tradeinPriceGbp) : null,
    lastUpdated: p.lastUpdated,
  }));

  return {
    prices: transformedPrices,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    releases: releases.map((r: { releaseSet: string | null }) => r.releaseSet).filter((r: string | null): r is string => r !== null),
    sets: sets.map((s: { setCode: string | null }) => s.setCode).filter((s: string | null): s is string => s !== null),
    stats: {
      totalPrices: stats._count,
      averageTradeIn: stats._avg.tradeinPriceGbp ? Number(stats._avg.tradeinPriceGbp) : 0,
    },
    filters: {
      search,
      release: releaseFilter,
      set: setFilter,
      sort,
    },
    shop: session.shop,
  };
};


// Helper to format GBP price
function formatGbp(value: number | null): string {
  if (value === null) return "—";
  return `£${value.toFixed(2)}`;
}

// Price type from loader
interface PriceRow {
  id: string;
  releaseSet: string | null;
  fullCardNumber: string | null;
  setCode: string | null;
  cardNumber: string | null;
  name: string;
  variantType: string | null;
  rarity: string | null;
  optcgPrice: number | null;
  bestPrice: number | null;
  tradeinPrice: number | null;
  lastUpdated: Date | null;
}

export default function Prices() {
  const {
    prices,
    pagination,
    releases,
    sets,
    stats,
    filters,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoading = navigation.state === "loading";

  // Local filter state
  const [searchValue, setSearchValue] = useState(filters.search);
  const [releaseFilter, setReleaseFilter] = useState(filters.release);
  const [setFilter, setSetFilter] = useState(filters.set);

  const handleSearch = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (searchValue) {
      params.set("search", searchValue);
    } else {
      params.delete("search");
    }
    params.set("page", "1");
    setSearchParams(params);
  }, [searchValue, searchParams, setSearchParams]);

  const handleReleaseChange = useCallback(
    (value: string) => {
      setReleaseFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("release", value);
      } else {
        params.delete("release");
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleSetChange = useCallback(
    (value: string) => {
      setSetFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("set", value);
      } else {
        params.delete("set");
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleSortChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("sort", value);
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("page", newPage.toString());
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const resourceName = {
    singular: "card",
    plural: "cards",
  };

  const releaseOptions = [
    { label: "All Releases", value: "" },
    ...releases.map((r: string) => ({ label: r.toUpperCase(), value: r })),
  ];

  const setOptions = [
    { label: "All Sets", value: "" },
    ...sets.map((s: string) => ({ label: s.toUpperCase(), value: s })),
  ];

  const sortOptions = [
    { label: "Card Number", value: "card-number" },
    { label: "Name", value: "name" },
    { label: "Price: Low to High", value: "price-asc" },
    { label: "Price: High to Low", value: "price-desc" },
    { label: "Recently Updated", value: "updated" },
  ];

  const rowMarkup = (prices as PriceRow[]).map((price: PriceRow, index: number) => (
    <IndexTable.Row
      id={price.id}
      key={price.id}
      position={index}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {price.releaseSet?.toUpperCase() || "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {price.fullCardNumber?.toUpperCase() || "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text variant="bodyMd" as="span">
            {price.name}
          </Text>
          {(price.variantType || price.rarity) && (
            <InlineStack gap="100">
              {price.variantType && (
                <Badge size="small">{price.variantType}</Badge>
              )}
              {price.rarity && (
                <Badge size="small" tone="attention">{price.rarity}</Badge>
              )}
            </InlineStack>
          )}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {formatGbp(price.optcgPrice)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="semibold" as="span">
          {formatGbp(price.tradeinPrice)}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const emptyStateMarkup = (
    <EmptyState
      heading="No prices found"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        {filters.search
          ? "Try adjusting your search or filters"
          : "No card prices available"}
      </p>
    </EmptyState>
  );

  const filtersMarkup = (
    <Filters
      queryValue={searchValue}
      queryPlaceholder="Search cards..."
      onQueryChange={setSearchValue}
      onQueryClear={() => {
        setSearchValue("");
        const params = new URLSearchParams(searchParams);
        params.delete("search");
        setSearchParams(params);
      }}
      onClearAll={() => {
        setSearchValue("");
        setReleaseFilter("");
        setSetFilter("");
        setSearchParams(new URLSearchParams());
      }}
      filters={[
        {
          key: "release",
          label: "Release",
          filter: (
            <Select
              label=""
              labelHidden
              options={releaseOptions}
              value={releaseFilter}
              onChange={handleReleaseChange}
            />
          ),
          shortcut: true,
        },
        {
          key: "set",
          label: "Set",
          filter: (
            <Select
              label=""
              labelHidden
              options={setOptions}
              value={setFilter}
              onChange={handleSetChange}
            />
          ),
          shortcut: true,
        },
      ]}
    >
      <Button onClick={handleSearch}>Search</Button>
    </Filters>
  );

  return (
    <Page title="Card Prices">
      <Layout>
        {/* Stats Cards */}
        <Layout.Section>
          <InlineStack gap="400" wrap={false}>
            <Box minWidth="200px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {stats.totalPrices.toLocaleString()}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Total Cards
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="200px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {formatGbp(stats.averageTradeIn)}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Avg Trade-In
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="200px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {sets.length}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Sets Available
                  </Text>
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>
        </Layout.Section>

        {/* Price Table */}
        <Layout.Section>
          <Card padding="0">
            <BlockStack gap="0">
              <Box padding="400">
                <InlineStack align="space-between">
                  <Box minWidth="70%">{filtersMarkup}</Box>
                  <Select
                    label="Sort by"
                    labelInline
                    options={sortOptions}
                    value={filters.sort}
                    onChange={handleSortChange}
                  />
                </InlineStack>
              </Box>

              <IndexTable
                resourceName={resourceName}
                itemCount={prices.length}
                selectable={false}
                headings={[
                  { title: "Release" },
                  { title: "Card #" },
                  { title: "Name" },
                  { title: "OPTCG Price" },
                  { title: "Trade-In" },
                ]}
                loading={isLoading}
                emptyState={emptyStateMarkup}
              >
                {rowMarkup}
              </IndexTable>

              {pagination.totalPages > 1 && (
                <Box padding="400" borderBlockStartWidth="025" borderColor="border">
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={pagination.page > 1}
                      onPrevious={() => handlePageChange(pagination.page - 1)}
                      hasNext={pagination.page < pagination.totalPages}
                      onNext={() => handlePageChange(pagination.page + 1)}
                      label={`Page ${pagination.page} of ${pagination.totalPages}`}
                    />
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Banner tone="info">
            Prices are sourced from OPTCG TCGplayer. Trade-in prices are automatically calculated based on market data.
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
