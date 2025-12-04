import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Form, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Box,
  InlineGrid,
  Select,
  DataTable,
  Divider,
} from "@shopify/polaris";
import { SubmissionStatus, formatPrice } from "../lib/constants";

// ============================================================================
// Types
// ============================================================================

interface SummaryStats {
  totalSubmissions: number;
  totalCompleted: number;
  totalCancelled: number;
  totalReturned: number;
  totalValue: number;
  avgSubmissionValue: number;
  avgItemsPerSubmission: number;
  totalCards: number;
}

interface StatusBreakdown {
  status: string;
  count: number;
  value: number;
  percentage: number;
}

interface PayoutBreakdown {
  type: string;
  count: number;
  value: number;
  percentage: number;
}

interface TopCard {
  cardName: string;
  setName: string;
  quantity: number;
  totalValue: number;
}

interface DailyStats {
  date: string;
  submissions: number;
  completed: number;
  value: number;
}

interface LoaderData {
  period: string;
  dateRange: { start: string; end: string };
  summary: SummaryStats;
  statusBreakdown: StatusBreakdown[];
  payoutBreakdown: PayoutBreakdown[];
  topCards: TopCard[];
  dailyStats: DailyStats[];
}

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    console.log("[app.reports] Auth OK, shop:", session?.shop);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "30d";

  // Calculate date range
  const endDate = new Date();
  let startDate = new Date();

  switch (period) {
    case "7d":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(startDate.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(startDate.getDate() - 90);
      break;
    case "year":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case "all":
      startDate = new Date(0); // Beginning of time
      break;
    default:
      startDate.setDate(startDate.getDate() - 30);
  }

  const dateFilter = period === "all" ? {} : { createdAt: { gte: startDate, lte: endDate } };

  // Fetch all data in parallel
  const [
    totalSubmissions,
    submissionsByStatus,
    completedSubmissions,
    payoutStats,
    totalCards,
    topCardsRaw,
    dailySubmissions,
  ] = await Promise.all([
    // Total submissions
    prisma.tradeInSubmission.count({
      where: {
        ...dateFilter,
        status: { not: SubmissionStatus.DRAFT },
      },
    }),

    // Submissions by status
    prisma.tradeInSubmission.groupBy({
      by: ["status"],
      where: {
        ...dateFilter,
        status: { not: SubmissionStatus.DRAFT },
      },
      _count: { id: true },
      _sum: { quotedTotal: true },
    }),

    // Completed submissions details
    prisma.tradeInSubmission.aggregate({
      where: {
        ...dateFilter,
        status: SubmissionStatus.COMPLETED,
      },
      _count: { id: true },
      _sum: { finalTotal: true },
    }),

    // Payout stats by type
    prisma.tradeInSubmission.groupBy({
      by: ["payoutType"],
      where: {
        ...dateFilter,
        status: { in: [SubmissionStatus.COMPLETED, SubmissionStatus.APPROVED] },
      },
      _count: { id: true },
      _sum: { quotedTotal: true },
    }),

    // Total cards traded
    prisma.tradeInItem.aggregate({
      where: {
        submission: {
          ...dateFilter,
          status: { not: SubmissionStatus.DRAFT },
        },
      },
      _sum: { quantity: true },
    }),

    // Top traded cards
    prisma.tradeInItem.groupBy({
      by: ["cardName", "setName"],
      where: {
        submission: {
          ...dateFilter,
          status: { in: [SubmissionStatus.COMPLETED, SubmissionStatus.APPROVED] },
        },
      },
      _sum: { quantity: true, quotedPrice: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    }),

    // Daily submissions (for chart data)
    prisma.$queryRaw<Array<{ date: Date; count: bigint; value: bigint }>>`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count,
        COALESCE(SUM(quoted_total), 0) as value
      FROM trade_in_submissions
      WHERE status != ${SubmissionStatus.DRAFT}
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `.catch(() => [] as Array<{ date: Date; count: bigint; value: bigint }>),
  ]);

  // Calculate summary stats
  const totalValue = submissionsByStatus.reduce(
    (sum, s) => sum + (s._sum.quotedTotal || 0),
    0
  );

  const statusCounts = Object.fromEntries(
    submissionsByStatus.map((s) => [s.status, s._count.id])
  );

  const summary: SummaryStats = {
    totalSubmissions,
    totalCompleted: statusCounts[SubmissionStatus.COMPLETED] || 0,
    totalCancelled: statusCounts[SubmissionStatus.CANCELLED] || 0,
    totalReturned: statusCounts[SubmissionStatus.RETURNED] || 0,
    totalValue,
    avgSubmissionValue: totalSubmissions > 0 ? Math.round(totalValue / totalSubmissions) : 0,
    avgItemsPerSubmission: totalSubmissions > 0
      ? Math.round((totalCards._sum.quantity || 0) / totalSubmissions)
      : 0,
    totalCards: totalCards._sum.quantity || 0,
  };

  // Format status breakdown
  const statusBreakdown: StatusBreakdown[] = submissionsByStatus.map((s) => ({
    status: s.status,
    count: s._count.id,
    value: s._sum.quotedTotal || 0,
    percentage: totalSubmissions > 0 ? Math.round((s._count.id / totalSubmissions) * 100) : 0,
  }));

  // Format payout breakdown
  const payoutTotal = payoutStats.reduce((sum, p) => sum + p._count.id, 0);
  const payoutBreakdown: PayoutBreakdown[] = payoutStats.map((p) => ({
    type: p.payoutType || "Unknown",
    count: p._count.id,
    value: p._sum.quotedTotal || 0,
    percentage: payoutTotal > 0 ? Math.round((p._count.id / payoutTotal) * 100) : 0,
  }));

  // Format top cards
  const topCards: TopCard[] = topCardsRaw.map((c) => ({
    cardName: c.cardName,
    setName: c.setName,
    quantity: c._sum.quantity || 0,
    totalValue: c._sum.quotedPrice || 0,
  }));

  // Format daily stats
  const dailyStats: DailyStats[] = dailySubmissions.map((d) => ({
    date: d.date.toISOString().split("T")[0],
    submissions: Number(d.count),
    completed: 0, // Would need separate query for completed per day
    value: Number(d.value),
  }));

  return {
    period,
    dateRange: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    },
    summary,
    statusBreakdown,
    payoutBreakdown,
    topCards,
    dailyStats,
  };
};

// ============================================================================
// Component
// ============================================================================

export default function Reports() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  // Handle Response objects from auth
  if (!data || "status" in data) {
    return null;
  }

  const { period, dateRange, summary, statusBreakdown, payoutBreakdown, topCards } = data;

  const periodOptions = [
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "Last 90 days", value: "90d" },
    { label: "Last year", value: "year" },
    { label: "All time", value: "all" },
  ];

  const statusLabels: Record<string, string> = {
    SUBMITTED: "Submitted",
    IN_TRANSIT: "In Transit",
    RECEIVED: "Received",
    GRADING: "Grading",
    PENDING_APPROVAL: "Pending Approval",
    APPROVED: "Approved",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    RETURNED: "Returned",
  };

  const payoutLabels: Record<string, string> = {
    STORE_CREDIT: "Store Credit",
    BANK: "Bank Transfer",
  };

  // Format rows for status breakdown table
  const statusRows = statusBreakdown.map((s) => [
    statusLabels[s.status] || s.status,
    s.count.toString(),
    formatPrice(s.value),
    `${s.percentage}%`,
  ]);

  // Format rows for payout breakdown table
  const payoutRows = payoutBreakdown.map((p) => [
    payoutLabels[p.type] || p.type,
    p.count.toString(),
    formatPrice(p.value),
    `${p.percentage}%`,
  ]);

  // Format rows for top cards table
  const topCardsRows = topCards.map((c, index) => [
    (index + 1).toString(),
    c.cardName,
    c.setName,
    c.quantity.toString(),
    formatPrice(c.totalValue),
  ]);

  return (
    <Page
      title="Reports"
      subtitle={`${dateRange.start} to ${dateRange.end}`}
      primaryAction={
        <Button url="/app/reports/export" variant="primary">
          Export Data
        </Button>
      }
    >
      <BlockStack gap="500">
        {/* Period Selector */}
        <Card>
          <Form method="get">
            <InlineStack gap="400" align="start" blockAlign="center">
              <Box minWidth="200px">
                <Select
                  label="Time Period"
                  labelHidden
                  options={periodOptions}
                  value={period}
                  onChange={(value) => {
                    const newParams = new URLSearchParams(searchParams);
                    newParams.set("period", value);
                    window.location.href = `/app/reports?${newParams.toString()}`;
                  }}
                />
              </Box>
              <Text as="span" variant="bodyMd" tone="subdued">
                Showing data from {dateRange.start} to {dateRange.end}
              </Text>
            </InlineStack>
          </Form>
        </Card>

        {/* Summary Stats */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Total Submissions</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {summary.totalSubmissions.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Total Cards Traded</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {summary.totalCards.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Total Value</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {formatPrice(summary.totalValue)}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Avg. Submission Value</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {formatPrice(summary.avgSubmissionValue)}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Secondary Stats */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Completed</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {summary.totalCompleted.toLocaleString()}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {summary.totalSubmissions > 0
                  ? `${Math.round((summary.totalCompleted / summary.totalSubmissions) * 100)}% completion rate`
                  : "0% completion rate"}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Cancelled</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {summary.totalCancelled.toLocaleString()}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {summary.totalSubmissions > 0
                  ? `${Math.round((summary.totalCancelled / summary.totalSubmissions) * 100)}% cancellation rate`
                  : "0% cancellation rate"}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Returned</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {summary.totalReturned.toLocaleString()}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {summary.totalSubmissions > 0
                  ? `${Math.round((summary.totalReturned / summary.totalSubmissions) * 100)}% return rate`
                  : "0% return rate"}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Avg. Cards per Submission</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {summary.avgItemsPerSubmission}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Status Breakdown */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Status Breakdown</Text>
            {statusBreakdown.length === 0 ? (
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  No data for this period
                </Text>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                headings={["Status", "Count", "Value", "% of Total"]}
                rows={statusRows}
              />
            )}
          </BlockStack>
        </Card>

        {/* Payout Methods */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Payout Methods</Text>
            {payoutBreakdown.length === 0 ? (
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  No completed payouts for this period
                </Text>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                headings={["Method", "Count", "Value", "% of Total"]}
                rows={payoutRows}
              />
            )}
          </BlockStack>
        </Card>

        {/* Top Cards */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Top Traded Cards</Text>
            {topCards.length === 0 ? (
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  No cards traded for this period
                </Text>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["numeric", "text", "text", "numeric", "numeric"]}
                headings={["#", "Card Name", "Set", "Qty", "Total Value"]}
                rows={topCardsRows}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
