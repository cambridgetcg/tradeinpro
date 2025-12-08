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
  Link,
} from "react-router";
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
  Modal,
  FormLayout,
  TextField,
  Banner,
  EmptyState,
  Tabs,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  searchPayouts,
  getPayoutStats,
  processStoreCreditPayout,
  markBankTransferProcessing,
  markBankTransferCompleted,
  retryPayout,
  exportBankTransfers,
} from "../lib/payouts.server";
import {
  formatPrice,
  PayoutStatus,
  PayoutType,
  PayoutTypeLabels,
  type PayoutStatusType,
} from "../lib/constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const status = url.searchParams.get("status") as PayoutStatusType | null;
  const type = url.searchParams.get("type") as string | null;
  const page = parseInt(url.searchParams.get("page") || "1");

  const [searchResult, stats] = await Promise.all([
    searchPayouts({
      status: status || undefined,
      type: type as typeof PayoutType[keyof typeof PayoutType] | undefined,
      page,
      limit: 20,
    }),
    getPayoutStats(),
  ]);

  return {
    payouts: searchResult.payouts,
    pagination: searchResult.pagination,
    stats,
    filters: {
      status,
      type,
    },
    shop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "issueGiftCard") {
    const payoutId = formData.get("payoutId") as string;

    const result = await processStoreCreditPayout(payoutId, admin);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: `Gift card issued: ${result.giftCard?.code}`,
      giftCard: result.giftCard,
    };
  }

  if (intent === "markProcessing") {
    const payoutId = formData.get("payoutId") as string;
    const bankReference = formData.get("bankReference") as string;

    if (!bankReference) {
      return { success: false, error: "Bank reference is required" };
    }

    const result = await markBankTransferProcessing(payoutId, bankReference);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, message: "Marked as processing" };
  }

  if (intent === "markCompleted") {
    const payoutId = formData.get("payoutId") as string;

    const result = await markBankTransferCompleted(payoutId);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, message: "Payout completed" };
  }

  if (intent === "retry") {
    const payoutId = formData.get("payoutId") as string;

    const result = await retryPayout(payoutId);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, message: "Payout reset to pending" };
  }

  if (intent === "exportBank") {
    const result = await exportBankTransfers();

    return {
      success: true,
      message: `Export ready with ${result.count} transfers`,
      exportData: result.data,
    };
  }

  return { success: false, error: "Unknown action" };
};

export default function Payouts() {
  const { payouts, pagination, stats, filters } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoading = navigation.state === "loading" || navigation.state === "submitting";

  // Modal states
  const [bankRefModal, setBankRefModal] = useState<{ open: boolean; payoutId: string | null }>({
    open: false,
    payoutId: null,
  });
  const [bankReference, setBankReference] = useState("");

  // Tab selection based on status filter
  const statusTabs = [
    { id: "all", content: "All", badge: undefined },
    { id: PayoutStatus.PENDING, content: "Pending", badge: stats.pending.toString() },
    { id: PayoutStatus.PROCESSING, content: "Processing", badge: stats.processing.toString() },
    { id: PayoutStatus.COMPLETED, content: "Completed", badge: stats.completed.toString() },
    { id: PayoutStatus.FAILED, content: "Failed", badge: stats.failed.toString() },
  ];

  const selectedTabIndex = statusTabs.findIndex(
    (tab) => tab.id === (filters.status || "all")
  );

  const handleTabChange = useCallback(
    (selectedIndex: number) => {
      const tab = statusTabs[selectedIndex];
      const params = new URLSearchParams(searchParams);
      if (tab.id === "all") {
        params.delete("status");
      } else {
        params.set("status", tab.id);
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams, statusTabs]
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("page", newPage.toString());
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleIssueGiftCard = (payoutId: string) => {
    const formData = new FormData();
    formData.set("intent", "issueGiftCard");
    formData.set("payoutId", payoutId);
    submit(formData, { method: "post" });
  };

  const handleMarkProcessing = () => {
    if (!bankRefModal.payoutId || !bankReference) return;

    const formData = new FormData();
    formData.set("intent", "markProcessing");
    formData.set("payoutId", bankRefModal.payoutId);
    formData.set("bankReference", bankReference);
    submit(formData, { method: "post" });

    setBankRefModal({ open: false, payoutId: null });
    setBankReference("");
  };

  const handleMarkCompleted = (payoutId: string) => {
    const formData = new FormData();
    formData.set("intent", "markCompleted");
    formData.set("payoutId", payoutId);
    submit(formData, { method: "post" });
  };

  const handleRetry = (payoutId: string) => {
    const formData = new FormData();
    formData.set("intent", "retry");
    formData.set("payoutId", payoutId);
    submit(formData, { method: "post" });
  };

  const handleExportBank = () => {
    const formData = new FormData();
    formData.set("intent", "exportBank");
    submit(formData, { method: "post" });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case PayoutStatus.PENDING:
        return <Badge tone="attention">Pending</Badge>;
      case PayoutStatus.PROCESSING:
        return <Badge tone="info">Processing</Badge>;
      case PayoutStatus.COMPLETED:
        return <Badge tone="success">Completed</Badge>;
      case PayoutStatus.FAILED:
        return <Badge tone="critical">Failed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getActionButton = (payout: (typeof payouts)[0]) => {
    if (payout.status === PayoutStatus.PENDING) {
      if (payout.type === PayoutType.STORE_CREDIT) {
        return (
          <Button size="slim" onClick={() => handleIssueGiftCard(payout.id)}>
            Issue Gift Card
          </Button>
        );
      } else {
        return (
          <Button
            size="slim"
            onClick={() => setBankRefModal({ open: true, payoutId: payout.id })}
          >
            Mark Processing
          </Button>
        );
      }
    }

    if (payout.status === PayoutStatus.PROCESSING) {
      return (
        <Button size="slim" onClick={() => handleMarkCompleted(payout.id)}>
          Mark Completed
        </Button>
      );
    }

    if (payout.status === PayoutStatus.FAILED) {
      return (
        <Button size="slim" onClick={() => handleRetry(payout.id)}>
          Retry
        </Button>
      );
    }

    return null;
  };

  const resourceName = {
    singular: "payout",
    plural: "payouts",
  };

  const rowMarkup = payouts.map((payout, index) => (
    <IndexTable.Row id={payout.id} key={payout.id} position={index}>
      <IndexTable.Cell>
        <Link to={`/app/trade-ins/${payout.submissionId}`}>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            #{payout.submission.submissionNumber}
          </Text>
        </Link>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {payout.customer.firstName} {payout.customer.lastName}
        </Text>
        <br />
        <Text variant="bodySm" as="span" tone="subdued">
          {payout.customer.email}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge>{PayoutTypeLabels[payout.type as keyof typeof PayoutTypeLabels] || payout.type}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {formatPrice(payout.totalAmount)}
        </Text>
        {payout.bonusAmount !== 0 && (
          <Text
            variant="bodySm"
            as="span"
            tone={payout.bonusAmount > 0 ? "success" : "critical"}
          >
            {" "}
            ({payout.bonusAmount > 0 ? "+" : ""}
            {formatPrice(payout.bonusAmount)})
          </Text>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>{getStatusBadge(payout.status)}</IndexTable.Cell>
      <IndexTable.Cell>
        {payout.giftCardCode && (
          <Text variant="bodySm" as="span" tone="subdued">
            {payout.giftCardCode}
          </Text>
        )}
        {payout.bankReference && (
          <Text variant="bodySm" as="span" tone="subdued">
            Ref: {payout.bankReference}
          </Text>
        )}
        {payout.failureReason && (
          <Text variant="bodySm" as="span" tone="critical">
            {payout.failureReason}
          </Text>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>{getActionButton(payout)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  const emptyStateMarkup = (
    <EmptyState
      heading="No payouts found"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        {filters.status
          ? `No ${filters.status.toLowerCase()} payouts`
          : "Payouts will appear here when submissions are approved"}
      </p>
    </EmptyState>
  );

  return (
    <Page
      title="Payouts"
      secondaryActions={[
        {
          content: "Export Bank Transfers",
          onAction: handleExportBank,
          disabled: stats.pending === 0,
        },
      ]}
    >
      <Layout>
        {actionData?.message && (
          <Layout.Section>
            <Banner
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => {}}
            >
              {actionData.message}
              {!actionData.success && (actionData as { error?: string }).error && (
                <p>{(actionData as { error?: string }).error}</p>
              )}
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
                    {formatPrice(stats.totalPending)}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Pending Payouts
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="150px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {stats.pending}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Awaiting Action
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="150px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {stats.processing}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Processing
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="150px">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {formatPrice(stats.totalCompleted)}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Total Paid Out
                  </Text>
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>
        </Layout.Section>

        {/* Payouts Table */}
        <Layout.Section>
          <Card padding="0">
            <BlockStack gap="0">
              <Box paddingInline="400" paddingBlockStart="400">
                <Tabs
                  tabs={statusTabs.map((tab) => ({
                    id: tab.id,
                    content: tab.badge ? `${tab.content} (${tab.badge})` : tab.content,
                    accessibilityLabel: tab.content,
                  }))}
                  selected={selectedTabIndex}
                  onSelect={handleTabChange}
                  fitted
                />
              </Box>

              <IndexTable
                resourceName={resourceName}
                itemCount={payouts.length}
                headings={[
                  { title: "Submission" },
                  { title: "Customer" },
                  { title: "Type" },
                  { title: "Amount" },
                  { title: "Status" },
                  { title: "Details" },
                  { title: "Action" },
                ]}
                selectable={false}
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

      {/* Bank Reference Modal */}
      <Modal
        open={bankRefModal.open}
        onClose={() => {
          setBankRefModal({ open: false, payoutId: null });
          setBankReference("");
        }}
        title="Enter Bank Reference"
        primaryAction={{
          content: "Mark Processing",
          onAction: handleMarkProcessing,
          disabled: !bankReference,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setBankRefModal({ open: false, payoutId: null });
              setBankReference("");
            },
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Bank Reference"
              value={bankReference}
              onChange={setBankReference}
              autoComplete="off"
              placeholder="e.g., TRF-20240315-001"
              helpText="Enter the bank transfer reference for tracking"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
