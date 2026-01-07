import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Banner,
  DataTable,
  Button,
  Box,
  InlineGrid,
} from "@shopify/polaris";
import {
  SubmissionStatus,
  SubmissionStatusLabels,
  formatPrice,
} from "../lib/constants";

interface DashboardStats {
  pendingArrival: number;
  needsGrading: number;
  awaitingApproval: number;
  completedThisWeek: number;
  totalPendingValue: number;
  totalCompletedValue: number;
  totalActiveCards: number;
}

interface RecentSubmission {
  id: string;
  submissionNumber: string;
  status: string;
  customerName: string;
  quotedTotal: number;
  itemCount: number;
  createdAt: string;
}

interface Alert {
  type: "warning" | "info" | "critical";
  title: string;
  message: string;
  link?: string;
  linkText?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[app._index loader] Starting dashboard load");

  try {
    const { session } = await authenticate.admin(request);
    console.log("[app._index loader] Auth OK, shop:", session?.shop);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[app._index loader] Auth failed:", error instanceof Error ? error.message : error);
    throw error;
  }

  // Get date for "this week" calculation (last 7 days)
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Fetch all stats in parallel
  const [
    pendingArrivalCount,
    needsGradingCount,
    awaitingApprovalCount,
    completedThisWeekCount,
    pendingValueResult,
    completedValueResult,
    activeCardCount,
    recentSubmissions,
    oldPendingCount,
    highValuePendingCount,
    jpPriceLatest,
    enPriceLatest,
    historyLatest,
  ] = await Promise.all([
    // Pending arrival (SUBMITTED, IN_TRANSIT)
    prisma.tradeInSubmission.count({
      where: {
        status: {
          in: [SubmissionStatus.SUBMITTED, SubmissionStatus.IN_TRANSIT],
        },
      },
    }),

    // Needs grading (RECEIVED, GRADING)
    prisma.tradeInSubmission.count({
      where: {
        status: {
          in: [SubmissionStatus.RECEIVED, SubmissionStatus.GRADING],
        },
      },
    }),

    // Awaiting approval
    prisma.tradeInSubmission.count({
      where: { status: SubmissionStatus.PENDING_APPROVAL },
    }),

    // Completed this week
    prisma.tradeInSubmission.count({
      where: {
        status: SubmissionStatus.COMPLETED,
        completedAt: { gte: oneWeekAgo },
      },
    }),

    // Total pending value (sum of quotedTotal for active submissions)
    prisma.tradeInSubmission.aggregate({
      where: {
        status: {
          notIn: [
            SubmissionStatus.COMPLETED,
            SubmissionStatus.CANCELLED,
            SubmissionStatus.RETURNED,
            SubmissionStatus.DRAFT,
          ],
        },
      },
      _sum: { quotedTotal: true },
    }),

    // Total completed value (all time)
    prisma.payout.aggregate({
      where: { status: "COMPLETED" },
      _sum: { totalAmount: true },
    }),

    // Active cards in price list
    prisma.cardPrice.count({
      where: { isActive: true },
    }),

    // Recent submissions (last 10)
    prisma.tradeInSubmission.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      where: {
        status: {
          not: SubmissionStatus.DRAFT,
        },
      },
      include: {
        customer: {
          select: { firstName: true, lastName: true, email: true },
        },
        _count: { select: { items: true } },
      },
    }),

    // Submissions pending > 3 days (for alerts)
    prisma.tradeInSubmission.count({
      where: {
        status: {
          in: [SubmissionStatus.RECEIVED, SubmissionStatus.GRADING],
        },
        receivedAt: {
          lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      },
    }),

    // High value submissions pending approval (for alerts)
    prisma.tradeInSubmission.count({
      where: {
        status: SubmissionStatus.PENDING_APPROVAL,
        quotedTotal: { gte: 10000 }, // £100+
      },
    }),

    // Price data staleness checks
    prisma.japanesePriceSource.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),

    prisma.cardPriceV2.findFirst({
      where: { language: "EN" },
      orderBy: { lastUpdated: "desc" },
      select: { lastUpdated: true },
    }),

    prisma.cardPriceHistory.findFirst({
      orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true },
    }),
  ]);

  // Build stats object
  const stats: DashboardStats = {
    pendingArrival: pendingArrivalCount,
    needsGrading: needsGradingCount,
    awaitingApproval: awaitingApprovalCount,
    completedThisWeek: completedThisWeekCount,
    totalPendingValue: pendingValueResult._sum.quotedTotal ?? 0,
    totalCompletedValue: completedValueResult._sum.totalAmount ?? 0,
    totalActiveCards: activeCardCount,
  };

  // Format recent submissions
  const formattedSubmissions: RecentSubmission[] = recentSubmissions.map(
    (sub) => ({
      id: sub.id,
      submissionNumber: sub.submissionNumber,
      status: sub.status,
      customerName: sub.customer
        ? `${sub.customer.firstName || ""} ${sub.customer.lastName || ""}`.trim() ||
          sub.customer.email
        : "Unknown",
      quotedTotal: sub.quotedTotal,
      itemCount: sub._count.items,
      createdAt: sub.createdAt.toISOString(),
    })
  );

  // Build alerts
  const alerts: Alert[] = [];

  if (oldPendingCount > 0) {
    alerts.push({
      type: "warning",
      title: `${oldPendingCount} submission${oldPendingCount > 1 ? "s" : ""} awaiting grading > 3 days`,
      message: "These submissions have been waiting for grading for more than 3 days.",
      link: "/app/trade-ins?status=GRADING&sort=oldest",
      linkText: "View submissions",
    });
  }

  if (highValuePendingCount > 0) {
    alerts.push({
      type: "info",
      title: `${highValuePendingCount} high-value submission${highValuePendingCount > 1 ? "s" : ""} pending approval`,
      message: "Submissions worth £100+ are awaiting customer approval.",
      link: "/app/trade-ins?status=PENDING_APPROVAL&sort=value",
      linkText: "Review submissions",
    });
  }

  if (stats.needsGrading > 10) {
    alerts.push({
      type: "critical",
      title: "Grading backlog detected",
      message: `You have ${stats.needsGrading} submissions waiting to be graded.`,
      link: "/app/trade-ins?status=RECEIVED",
      linkText: "Start grading",
    });
  }

  // Price data staleness alerts (> 26 hours = missed daily sync)
  const now = Date.now();
  const STALE_THRESHOLD_HOURS = 26;

  if (jpPriceLatest?.updatedAt) {
    const jpHoursStale = (now - jpPriceLatest.updatedAt.getTime()) / (1000 * 60 * 60);
    if (jpHoursStale > STALE_THRESHOLD_HOURS) {
      alerts.push({
        type: "critical",
        title: "JP prices stale",
        message: `Japanese card prices haven't updated in ${Math.round(jpHoursStale)} hours. Check Vercel cron logs.`,
        link: "/app/jp-prices",
        linkText: "View JP prices",
      });
    }
  }

  if (enPriceLatest?.lastUpdated) {
    const enHoursStale = (now - enPriceLatest.lastUpdated.getTime()) / (1000 * 60 * 60);
    if (enHoursStale > STALE_THRESHOLD_HOURS) {
      alerts.push({
        type: "critical",
        title: "EN prices stale",
        message: `English card prices haven't updated in ${Math.round(enHoursStale)} hours. Check Lambda/OPTCG sync.`,
        link: "/app/prices",
        linkText: "View prices",
      });
    }
  }

  if (historyLatest?.snapshotDate) {
    const historyHoursStale = (now - historyLatest.snapshotDate.getTime()) / (1000 * 60 * 60);
    if (historyHoursStale > STALE_THRESHOLD_HOURS) {
      alerts.push({
        type: "warning",
        title: "Price history stale",
        message: `Daily price snapshots haven't run in ${Math.round(historyHoursStale)} hours. Check price-snapshot cron.`,
      });
    }
  }

  return {
    stats,
    recentSubmissions: formattedSubmissions,
    alerts,
  };
};

export default function Dashboard() {
  const { stats, recentSubmissions, alerts } = useLoaderData<typeof loader>();

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  };

  const getStatusBadge = (status: string) => {
    const statusTones: Record<string, "info" | "success" | "warning" | "critical" | "attention"> = {
      DRAFT: "info",
      SUBMITTED: "info",
      IN_TRANSIT: "info",
      RECEIVED: "attention",
      GRADING: "attention",
      PENDING_APPROVAL: "warning",
      APPROVED: "success",
      COMPLETED: "success",
      CANCELLED: "critical",
      RETURNED: "critical",
    };

    const label =
      SubmissionStatusLabels[status as keyof typeof SubmissionStatusLabels] ||
      status.replace(/_/g, " ");

    return <Badge tone={statusTones[status] || "info"}>{label}</Badge>;
  };

  const recentActivityRows = recentSubmissions.map((submission) => [
    <Link key={submission.id} to={`/app/trade-ins/${submission.id}`} style={{ textDecoration: "none" }}>
      <Text as="span" fontWeight="semibold">{submission.submissionNumber}</Text>
    </Link>,
    submission.customerName,
    getStatusBadge(submission.status),
    `${submission.itemCount} item${submission.itemCount !== 1 ? "s" : ""}`,
    formatPrice(submission.quotedTotal),
    formatDate(submission.createdAt),
  ]);

  return (
    <Page
      title="Trade-In Dashboard"
      subtitle="Manage your card trade-in submissions"
      primaryAction={
        <Button variant="primary" url="/app/trade-ins">
          View All Submissions
        </Button>
      }
    >
      <BlockStack gap="500">
        {/* Alerts */}
        {alerts.map((alert, index) => (
          <Banner
            key={index}
            title={alert.title}
            tone={alert.type === "critical" ? "critical" : alert.type === "warning" ? "warning" : "info"}
            action={alert.link ? { content: alert.linkText || "View", url: alert.link } : undefined}
          >
            <p>{alert.message}</p>
          </Banner>
        ))}

        {/* Stats Cards */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Pending Arrival</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">{stats.pendingArrival}</Text>
              <Link to="/app/trade-ins?status=SUBMITTED,IN_TRANSIT">
                <Text as="span" variant="bodySm" tone="subdued">View submissions</Text>
              </Link>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Needs Grading</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">{stats.needsGrading}</Text>
              <Link to="/app/trade-ins?status=RECEIVED,GRADING">
                <Text as="span" variant="bodySm" tone="subdued">Start grading</Text>
              </Link>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Awaiting Approval</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">{stats.awaitingApproval}</Text>
              <Link to="/app/trade-ins?status=PENDING_APPROVAL">
                <Text as="span" variant="bodySm" tone="subdued">Review submissions</Text>
              </Link>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Completed This Week</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">{stats.completedThisWeek}</Text>
              <Link to="/app/trade-ins?status=COMPLETED">
                <Text as="span" variant="bodySm" tone="subdued">View completed</Text>
              </Link>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Value Summary */}
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Pending Trade-In Value</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{formatPrice(stats.totalPendingValue)}</Text>
              <Text as="p" variant="bodySm" tone="subdued">Across active submissions</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Total Completed Payouts</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{formatPrice(stats.totalCompletedValue)}</Text>
              <Text as="p" variant="bodySm" tone="subdued">All time</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Active Cards in Price List</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{stats.totalActiveCards.toLocaleString()}</Text>
              <Link to="/app/prices">
                <Text as="span" variant="bodySm" tone="subdued">Manage prices</Text>
              </Link>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Recent Activity */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Recent Activity</Text>
              <Button variant="plain" url="/app/trade-ins">View all</Button>
            </InlineStack>

            {recentSubmissions.length === 0 ? (
              <Box padding="400">
                <BlockStack gap="200" align="center">
                  <Text as="p" tone="subdued">No submissions yet</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Trade-in submissions will appear here once customers start submitting.
                  </Text>
                </BlockStack>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
                headings={["Submission", "Customer", "Status", "Items", "Value", "Date"]}
                rows={recentActivityRows}
              />
            )}
          </BlockStack>
        </Card>

        {/* Storefront Setup */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Storefront Setup</Text>
              <Badge tone="attention">Setup Required</Badge>
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">
              Add the trade-in blocks to your theme to let customers submit trade-ins.
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Trade-In Form</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Main submission form for customers to search cards and submit trade-ins.
                </Text>
                <Button
                  url="shopify://admin/themes/current/editor?context=apps"
                  external
                >
                  Add to Theme
                </Button>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Submission Tracker</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Let customers check the status of their submission.
                </Text>
                <Button
                  url="shopify://admin/themes/current/editor?context=apps"
                  external
                  variant="secondary"
                >
                  Add to Theme
                </Button>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">CTA Block</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Promotional call-to-action with key trade-in features.
                </Text>
                <Button
                  url="shopify://admin/themes/current/editor?context=apps"
                  external
                  variant="secondary"
                >
                  Add to Theme
                </Button>
              </BlockStack>
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Quick Actions */}
        <Text as="h2" variant="headingMd">Quick Actions</Text>
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Price Management</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Update trade-in prices and add new cards
              </Text>
              <Button url="/app/prices">Manage Prices</Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Settings</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Configure multipliers, thresholds, and notifications
              </Text>
              <Button url="/app/settings">Open Settings</Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Payouts</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Process pending payouts and view history
              </Text>
              <Button url="/app/payouts">View Payouts</Button>
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
