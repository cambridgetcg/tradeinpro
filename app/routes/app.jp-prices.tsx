/**
 * Japanese Card Prices Admin Page
 *
 * Manage Japanese card price imports and sync to CardPriceV2
 */

import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, Form, useSubmit, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  InlineStack,
  BlockStack,
  Box,
  Pagination,
  Banner,
  EmptyState,
  DropZone,
  Modal,
  Filters,
  Select,
  Spinner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getJpPriceStats,
  searchJpPrices,
  getJpSetCodes,
  parseJapanesePriceCsv,
  importJapanesePrices,
  syncJapanesePricesToCards,
  clearJpPrices,
  fullS3Sync,
} from "../lib/jp-prices.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const search = url.searchParams.get("search") || "";
  const setCode = url.searchParams.get("setCode") || "";
  const synced = url.searchParams.get("synced");
  const page = parseInt(url.searchParams.get("page") || "1");

  const [stats, pricesResult, setCodes] = await Promise.all([
    getJpPriceStats(),
    searchJpPrices({
      search: search || undefined,
      setCode: setCode || undefined,
      synced: synced === "true" ? true : synced === "false" ? false : undefined,
      page,
      limit: 20,
    }),
    getJpSetCodes(),
  ]);

  return {
    stats,
    prices: pricesResult.records,
    pagination: pricesResult.pagination,
    setCodes,
    filters: { search, setCode, synced },
    shop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const actionType = formData.get("action");

  try {
    if (actionType === "upload") {
      const csvContent = formData.get("csvContent") as string;
      if (!csvContent) {
        return { success: false, error: "No CSV content provided" };
      }

      const { records, errors: parseErrors } = parseJapanesePriceCsv(csvContent);
      if (records.length === 0) {
        return { success: false, error: "No valid records found", parseErrors };
      }

      const result = await importJapanesePrices(records);
      return {
        success: true,
        action: "upload",
        result: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          totalProcessed: result.totalProcessed,
        },
        parseErrors,
      };
    }

    if (actionType === "sync") {
      const result = await syncJapanesePricesToCards(session.shop);
      return {
        success: true,
        action: "sync",
        result: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          totalProcessed: result.totalProcessed,
        },
      };
    }

    if (actionType === "clear") {
      const count = await clearJpPrices();
      return { success: true, action: "clear", count };
    }

    if (actionType === "s3sync") {
      // Full S3 sync: download from S3 + sync to CardPriceV2
      const result = await fullS3Sync(session.shop);
      return {
        success: true,
        action: "s3sync",
        result: {
          imported: {
            created: result.import.created,
            updated: result.import.updated,
            skipped: result.import.skipped,
          },
          synced: {
            created: result.sync.created,
            updated: result.sync.updated,
            skipped: result.sync.skipped,
          },
          totalProcessed: result.import.totalProcessed,
          lastModified: result.lastModified,
        },
      };
    }

    return { success: false, error: "Unknown action" };
  } catch (error) {
    console.error("JP prices action error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Action failed",
    };
  }
};

export const headers: typeof boundary.headers = boundary.headers;
export const ErrorBoundary = boundary.error;

export default function JpPricesPage() {
  const { stats, prices, pagination, setCodes, filters, shop } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [csvContent, setCsvContent] = useState("");
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const isLoading = navigation.state !== "idle";

  // Handle file drop
  const handleDrop = useCallback((_files: File[], acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setCsvContent(content);
      };
      reader.readAsText(file);
    }
  }, []);

  // Handle filter changes
  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleClearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  // Format price
  const formatPrice = (pence: number | null) => {
    if (pence === null) return "-";
    return `£${(pence / 100).toFixed(2)}`;
  };

  // Format date
  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("en-GB");
  };

  // Row markup for IndexTable
  const rowMarkup = prices.map((price, index) => (
    <IndexTable.Row id={price.id} key={price.id} position={index}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {price.sku}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{price.name}</IndexTable.Cell>
      <IndexTable.Cell>{price.setCode || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{price.variantType || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{formatPrice(price.priceGbp)}</IndexTable.Cell>
      <IndexTable.Cell>{formatPrice(price.tradeinPriceGbp)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={price.syncedToCardPrice ? "success" : "warning"}>
          {price.syncedToCardPrice ? "Synced" : "Pending"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDate(price.updatedAt)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Japanese Card Prices"
      subtitle="Import and manage Japanese One Piece card prices"
      primaryAction={{
        content: "Upload CSV",
        onAction: () => setUploadModalOpen(true),
      }}
      secondaryActions={[
        {
          content: "Sync from S3",
          onAction: () => {
            const formData = new FormData();
            formData.append("action", "s3sync");
            submit(formData, { method: "post" });
          },
          loading: isLoading,
        },
        {
          content: "Sync to Cards",
          onAction: () => {
            const formData = new FormData();
            formData.append("action", "sync");
            submit(formData, { method: "post" });
          },
          loading: isLoading,
        },
      ]}
    >
      <Layout>
        {/* Stats Banner */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Statistics
              </Text>
              <InlineStack gap="800" wrap>
                <BlockStack gap="100">
                  <Text variant="bodyMd" tone="subdued" as="p">
                    Total Records
                  </Text>
                  <Text variant="headingLg" as="p">
                    {stats.totalRecords.toLocaleString()}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodyMd" tone="subdued" as="p">
                    Synced to Cards
                  </Text>
                  <Text variant="headingLg" as="p">
                    {stats.syncedRecords.toLocaleString()}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodyMd" tone="subdued" as="p">
                    Pending Sync
                  </Text>
                  <Text variant="headingLg" as="p">
                    {stats.unsyncedRecords.toLocaleString()}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodyMd" tone="subdued" as="p">
                    Avg Price
                  </Text>
                  <Text variant="headingLg" as="p">
                    £{stats.averagePriceGbp.toFixed(2)}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodyMd" tone="subdued" as="p">
                    Last Updated
                  </Text>
                  <Text variant="headingLg" as="p">
                    {stats.lastUpdated ? formatDate(stats.lastUpdated) : "Never"}
                  </Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Upload Result */}
        {uploadResult && (
          <Layout.Section>
            <Banner
              title={uploadResult.success ? "Upload Complete" : "Upload Failed"}
              tone={uploadResult.success ? "success" : "critical"}
              onDismiss={() => setUploadResult(null)}
            >
              <p>{uploadResult.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Filters */}
        <Layout.Section>
          <Card padding="400">
            <Filters
              queryValue={filters.search}
              queryPlaceholder="Search by SKU or name..."
              onQueryChange={(value) => handleFilterChange("search", value)}
              onQueryClear={() => handleFilterChange("search", "")}
              onClearAll={handleClearFilters}
              filters={[
                {
                  key: "setCode",
                  label: "Set Code",
                  filter: (
                    <Select
                      label="Set Code"
                      labelHidden
                      options={[
                        { label: "All Sets", value: "" },
                        ...setCodes.map((code) => ({
                          label: code,
                          value: code,
                        })),
                      ]}
                      value={filters.setCode}
                      onChange={(value) => handleFilterChange("setCode", value)}
                    />
                  ),
                  shortcut: true,
                },
                {
                  key: "synced",
                  label: "Sync Status",
                  filter: (
                    <Select
                      label="Sync Status"
                      labelHidden
                      options={[
                        { label: "All", value: "" },
                        { label: "Synced", value: "true" },
                        { label: "Pending", value: "false" },
                      ]}
                      value={filters.synced || ""}
                      onChange={(value) => handleFilterChange("synced", value)}
                    />
                  ),
                  shortcut: true,
                },
              ]}
            />
          </Card>
        </Layout.Section>

        {/* Prices Table */}
        <Layout.Section>
          <Card padding="0">
            {prices.length === 0 ? (
              <EmptyState
                heading="No Japanese prices found"
                action={{
                  content: "Upload CSV",
                  onAction: () => setUploadModalOpen(true),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Upload a CSV file with Japanese card prices to get started.
                </p>
              </EmptyState>
            ) : (
              <>
                <IndexTable
                  resourceName={{ singular: "price", plural: "prices" }}
                  itemCount={prices.length}
                  headings={[
                    { title: "SKU" },
                    { title: "Name" },
                    { title: "Set" },
                    { title: "Variant" },
                    { title: "Price (GBP)" },
                    { title: "Trade-in" },
                    { title: "Status" },
                    { title: "Updated" },
                  ]}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>

                <Box padding="400">
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={pagination.page > 1}
                      hasNext={pagination.page < pagination.totalPages}
                      onPrevious={() =>
                        handleFilterChange("page", String(pagination.page - 1))
                      }
                      onNext={() =>
                        handleFilterChange("page", String(pagination.page + 1))
                      }
                    />
                    <Text variant="bodySm" tone="subdued" as="span">
                      Page {pagination.page} of {pagination.totalPages} (
                      {pagination.total.toLocaleString()} total)
                    </Text>
                  </InlineStack>
                </Box>
              </>
            )}
          </Card>
        </Layout.Section>

        {/* CSV Format Info */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                CSV Format
              </Text>
              <Text variant="bodyMd" as="p">
                Upload a CSV file with the following columns:
              </Text>
              <Box
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <Text variant="bodyMd" as="p" fontWeight="bold">
                  sku, name, set_code, card_number, variant_type, rarity, price_jpy, price_gbp
                </Text>
              </Box>
              <Text variant="bodySm" tone="subdued" as="p">
                Required: sku, name, and at least one price field (price_gbp or price_jpy).
                Prices in GBP should be in pounds (e.g., 28.50). JPY prices will be
                converted using current exchange rates.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Upload Modal */}
      <Modal
        open={uploadModalOpen}
        onClose={() => {
          setUploadModalOpen(false);
          setCsvContent("");
        }}
        title="Upload Japanese Card Prices"
        primaryAction={{
          content: "Upload",
          onAction: () => {
            if (csvContent) {
              const formData = new FormData();
              formData.append("action", "upload");
              formData.append("csvContent", csvContent);
              submit(formData, { method: "post" });
              setUploadModalOpen(false);
              setCsvContent("");
            }
          },
          disabled: !csvContent || isLoading,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setUploadModalOpen(false);
              setCsvContent("");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <DropZone onDrop={handleDrop} accept=".csv,text/csv">
              <DropZone.FileUpload actionHint="or drop CSV file to upload" />
            </DropZone>

            {csvContent && (
              <Banner tone="info">
                <p>
                  CSV loaded: {csvContent.split("\n").length - 1} rows detected
                </p>
              </Banner>
            )}

            <Text variant="bodySm" tone="subdued" as="p">
              Upload a CSV file containing Japanese card prices. Existing records
              with matching SKUs will be updated.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
