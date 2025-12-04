import { useState, useCallback } from "react";
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import {
  useLoaderData,
  useActionData,
  useSubmit,
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
  TextField,
  Select,
  Button,
  InlineStack,
  BlockStack,
  Box,
  Pagination,
  Modal,
  FormLayout,
  Checkbox,
  Banner,
  ProgressBar,
  Filters,
  ChoiceList,
  RangeSlider,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  searchPrices,
  getUniqueGames,
  getPriceStats,
  bulkUpdatePrices,
  deletePrices,
  syncPricesFromExternal,
  previewSync,
  getExternalGames,
  getExternalPriceCount,
} from "../lib/prices.server";
import { formatPrice } from "../lib/constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Parse search params
  const search = url.searchParams.get("search") || "";
  const game = url.searchParams.get("game") || "";
  const isActive = url.searchParams.get("isActive");
  const sort = (url.searchParams.get("sort") as "name" | "price-asc" | "price-desc" | "updated") || "name";
  const page = parseInt(url.searchParams.get("page") || "1");
  const minPrice = url.searchParams.get("minPrice") ? parseInt(url.searchParams.get("minPrice")!) : undefined;
  const maxPrice = url.searchParams.get("maxPrice") ? parseInt(url.searchParams.get("maxPrice")!) : undefined;

  const [searchResult, games, stats, externalGames, externalCount] = await Promise.all([
    searchPrices({
      search: search || undefined,
      game: game || undefined,
      isActive: isActive === "true" ? true : isActive === "false" ? false : undefined,
      sort,
      page,
      limit: 20,
      minPrice,
      maxPrice,
    }),
    getUniqueGames(),
    getPriceStats(),
    getExternalGames(),
    getExternalPriceCount(),
  ]);

  return {
    prices: searchResult.prices,
    pagination: searchResult.pagination,
    games,
    stats,
    externalGames,
    externalCount,
    filters: {
      search,
      game,
      isActive,
      sort,
      minPrice,
      maxPrice,
    },
    shop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "bulkSetActive" || intent === "bulkSetInactive") {
    const ids = JSON.parse(formData.get("ids") as string) as string[];
    const isActive = intent === "bulkSetActive";

    const result = await bulkUpdatePrices(ids, { isActive });

    return {
      success: true,
      message: `${result.success} prices ${isActive ? "activated" : "deactivated"}`,
    };
  }

  if (intent === "bulkDelete") {
    const ids = JSON.parse(formData.get("ids") as string) as string[];
    const result = await deletePrices(ids);

    return {
      success: true,
      message: `${result.success} prices deleted${result.failed > 0 ? ` (${result.failed} skipped - in use)` : ""}`,
    };
  }

  if (intent === "previewSync") {
    const game = formData.get("syncGame") as string || undefined;
    const overwriteExisting = formData.get("overwriteExisting") === "true";
    const applyMultipliers = formData.get("applyMultipliers") === "true";
    const skipBelowMinimum = formData.get("skipBelowMinimum") === "true";

    const preview = await previewSync(session.shop, {
      game,
      overwriteExisting,
      applyMultipliers,
      skipBelowMinimum,
    });

    return {
      success: true,
      preview,
    };
  }

  if (intent === "sync") {
    const game = formData.get("syncGame") as string || undefined;
    const overwriteExisting = formData.get("overwriteExisting") === "true";
    const applyMultipliers = formData.get("applyMultipliers") === "true";
    const skipBelowMinimum = formData.get("skipBelowMinimum") === "true";

    const result = await syncPricesFromExternal(session.shop, {
      game,
      overwriteExisting,
      applyMultipliers,
      skipBelowMinimum,
    });

    return {
      success: true,
      syncResult: result,
      message: `Sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
    };
  }

  return { success: false, message: "Unknown action" };
};

export default function Prices() {
  const {
    prices,
    pagination,
    games,
    stats,
    externalGames,
    externalCount,
    filters,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoading = navigation.state === "loading" || navigation.state === "submitting";

  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Sync modal state
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncGame, setSyncGame] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [applyMultipliers, setApplyMultipliers] = useState(true);
  const [skipBelowMinimum, setSkipBelowMinimum] = useState(true);

  // Local filter state
  const [searchValue, setSearchValue] = useState(filters.search);
  const [gameFilter, setGameFilter] = useState(filters.game);
  const [activeFilter, setActiveFilter] = useState<string[]>(
    filters.isActive ? [filters.isActive] : []
  );

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

  const handleGameChange = useCallback(
    (value: string) => {
      setGameFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("game", value);
      } else {
        params.delete("game");
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleActiveFilterChange = useCallback(
    (value: string[]) => {
      setActiveFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value.length > 0) {
        params.set("isActive", value[0]);
      } else {
        params.delete("isActive");
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

  const handleBulkAction = (action: "activate" | "deactivate" | "delete") => {
    const formData = new FormData();

    if (action === "activate") {
      formData.set("intent", "bulkSetActive");
    } else if (action === "deactivate") {
      formData.set("intent", "bulkSetInactive");
    } else {
      formData.set("intent", "bulkDelete");
    }

    formData.set("ids", JSON.stringify(selectedIds));
    submit(formData, { method: "post" });
    setSelectedIds([]);
  };

  const handleSync = () => {
    const formData = new FormData();
    formData.set("intent", "sync");
    formData.set("syncGame", syncGame);
    formData.set("overwriteExisting", overwriteExisting.toString());
    formData.set("applyMultipliers", applyMultipliers.toString());
    formData.set("skipBelowMinimum", skipBelowMinimum.toString());
    submit(formData, { method: "post" });
    setSyncModalOpen(false);
  };

  const resourceName = {
    singular: "price",
    plural: "prices",
  };

  const promotedBulkActions = [
    {
      content: "Set Active",
      onAction: () => handleBulkAction("activate"),
    },
    {
      content: "Set Inactive",
      onAction: () => handleBulkAction("deactivate"),
    },
  ];

  const bulkActions = [
    {
      content: "Delete",
      onAction: () => handleBulkAction("delete"),
      destructive: true,
    },
  ];

  const gameOptions = [
    { label: "All Games", value: "" },
    ...games.map((g) => ({ label: g, value: g })),
  ];

  const sortOptions = [
    { label: "Name A-Z", value: "name" },
    { label: "Price: Low to High", value: "price-asc" },
    { label: "Price: High to Low", value: "price-desc" },
    { label: "Recently Updated", value: "updated" },
  ];

  const rowMarkup = prices.map((price, index) => (
    <IndexTable.Row
      id={price.id}
      key={price.id}
      selected={selectedIds.includes(price.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {price.cardName}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {price.setName}
        </Text>
        {price.setCode && (
          <Text variant="bodySm" as="span" tone="subdued">
            {" "}
            ({price.setCode})
          </Text>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {price.variant && (
          <Badge tone="info">{price.variant}</Badge>
        )}
        {price.rarity && (
          <Badge>{price.rarity}</Badge>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Text variant="bodySm" as="span">
            <strong>NM</strong> {formatPrice(price.priceNM)}
          </Text>
          <Text variant="bodySm" as="span" tone="subdued">
            LP {formatPrice(price.priceLP)}
          </Text>
          <Text variant="bodySm" as="span" tone="subdued">
            MP {formatPrice(price.priceMP)}
          </Text>
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={price.isActive ? "success" : undefined}>
          {price.isActive ? "Active" : "Inactive"}
        </Badge>
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
          : "Sync prices from external sources or add them manually"}
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
        setGameFilter("");
        setActiveFilter([]);
        setSearchParams(new URLSearchParams());
      }}
      filters={[
        {
          key: "game",
          label: "Game",
          filter: (
            <Select
              label=""
              labelHidden
              options={gameOptions}
              value={gameFilter}
              onChange={handleGameChange}
            />
          ),
          shortcut: true,
        },
        {
          key: "status",
          label: "Status",
          filter: (
            <ChoiceList
              title="Status"
              titleHidden
              choices={[
                { label: "Active", value: "true" },
                { label: "Inactive", value: "false" },
              ]}
              selected={activeFilter}
              onChange={handleActiveFilterChange}
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
    <Page
      title="Card Prices"
      primaryAction={{
        content: "Sync Prices",
        onAction: () => setSyncModalOpen(true),
      }}
    >
      <Layout>
        {actionData?.message && (
          <Layout.Section>
            <Banner
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => {}}
            >
              {actionData.message}
            </Banner>
          </Layout.Section>
        )}

        {/* Stats Cards */}
        <Layout.Section>
          <InlineStack gap="400" wrap={false}>
            <Box minWidth="150px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {stats.totalPrices.toLocaleString()}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Total Prices
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="150px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {stats.activePrices.toLocaleString()}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Active
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="150px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {formatPrice(Math.round(stats.averageNMPrice))}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Avg NM Price
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="150px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {externalCount.toLocaleString()}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    External Prices
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
                selectedItemsCount={selectedIds.length}
                onSelectionChange={(selectionType, isSelecting, selection) => {
                  if (selectionType === "all") {
                    setSelectedIds(isSelecting ? prices.map((p) => p.id) : []);
                  } else if (selectionType === "page") {
                    setSelectedIds(isSelecting ? prices.map((p) => p.id) : []);
                  } else if (typeof selection === "string") {
                    if (isSelecting) {
                      setSelectedIds([...selectedIds, selection]);
                    } else {
                      setSelectedIds(selectedIds.filter((id) => id !== selection));
                    }
                  }
                }}
                headings={[
                  { title: "Card Name" },
                  { title: "Set" },
                  { title: "Details" },
                  { title: "Prices" },
                  { title: "Status" },
                ]}
                promotedBulkActions={promotedBulkActions}
                bulkActions={bulkActions}
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
      </Layout>

      {/* Sync Modal */}
      <Modal
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        title="Sync Prices from External Source"
        primaryAction={{
          content: isLoading ? "Syncing..." : "Start Sync",
          onAction: handleSync,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setSyncModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              Sync prices from the external price feed. This will update your
              internal card prices based on external market data.
            </Text>

            <FormLayout>
              <Select
                label="Game Filter"
                options={[
                  { label: "All Games", value: "" },
                  ...externalGames.map((g) => ({ label: g, value: g })),
                ]}
                value={syncGame}
                onChange={setSyncGame}
                helpText="Filter to sync only specific game prices"
              />

              <Checkbox
                label="Apply condition multipliers"
                checked={applyMultipliers}
                onChange={setApplyMultipliers}
                helpText="Apply your configured condition multipliers (NM, LP, etc.) to the base price"
              />

              <Checkbox
                label="Skip cards below minimum price"
                checked={skipBelowMinimum}
                onChange={setSkipBelowMinimum}
                helpText="Skip cards with NM price below £0.50"
              />

              <Checkbox
                label="Overwrite existing prices"
                checked={overwriteExisting}
                onChange={setOverwriteExisting}
                helpText="Warning: This will overwrite any manual price adjustments"
              />
            </FormLayout>

            {externalCount > 0 && (
              <Banner tone="info">
                {externalCount.toLocaleString()} external prices available
                {syncGame && ` (filtered by ${syncGame})`}
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
