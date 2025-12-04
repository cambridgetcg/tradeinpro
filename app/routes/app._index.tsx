import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[CARDFORUM] ========== DASHBOARD LOADER START ==========");

  try {
    const authResult = await authenticate.admin(request);
    console.log("[CARDFORUM] Dashboard auth success, shop:", authResult?.session?.shop);
  } catch (error) {
    if (error instanceof Response) {
      console.log("[CARDFORUM] Dashboard auth redirect:", error.status);
      throw error;
    }
    console.error("[CARDFORUM] Dashboard auth failed:", error);
    throw error;
  }

  console.log("[CARDFORUM] Fetching dashboard data...");

  // Get dashboard statistics
  const [
    pendingSubmissions,
    gradingSubmissions,
    approvalSubmissions,
    completedThisWeek,
    totalActiveCards,
    recentSubmissions,
    submissionStats,
  ] = await Promise.all([
    // Count pending submissions
    db.tradeInSubmission.count({
      where: { status: { in: ["SUBMITTED", "IN_TRANSIT"] } },
    }),
    // Count grading submissions
    db.tradeInSubmission.count({
      where: { status: { in: ["RECEIVED", "GRADING"] } },
    }),
    // Count awaiting approval
    db.tradeInSubmission.count({
      where: { status: "PENDING_APPROVAL" },
    }),
    // Completed this week
    db.tradeInSubmission.count({
      where: {
        status: "COMPLETED",
        completedAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    // Total active cards in price list
    db.cardPrice.count({
      where: { isActive: true },
    }),
    // Recent submissions
    db.tradeInSubmission.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        items: true,
      },
    }),
    // Weekly stats
    db.tradeInSubmission.groupBy({
      by: ["status"],
      _count: { status: true },
      _sum: { quotedTotal: true, finalTotal: true },
    }),
  ]);

  // Calculate totals
  const totalPendingValue = submissionStats
    .filter((s) => !["COMPLETED", "CANCELLED", "RETURNED"].includes(s.status))
    .reduce((sum, s) => sum + (s._sum.quotedTotal || 0), 0);

  const totalCompletedValue = submissionStats
    .filter((s) => s.status === "COMPLETED")
    .reduce((sum, s) => sum + (s._sum.finalTotal || 0), 0);

  return {
    stats: {
      pendingSubmissions,
      gradingSubmissions,
      approvalSubmissions,
      completedThisWeek,
      totalActiveCards,
      totalPendingValue,
      totalCompletedValue,
    },
    recentSubmissions,
  };
};

const statusColors: Record<string, "info" | "success" | "warning" | "critical" | "neutral"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  IN_TRANSIT: "info",
  RECEIVED: "warning",
  GRADING: "warning",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  COMPLETED: "success",
  CANCELLED: "critical",
  RETURNED: "critical",
};

export default function Dashboard() {
  const { stats, recentSubmissions } = useLoaderData<typeof loader>();

  const formatPrice = (cents: number) => `£${(cents / 100).toFixed(2)}`;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <s-page heading="Trade-In Dashboard">
      <Link to="/app/trade-ins" slot="primary-action" style={{ textDecoration: "none" }}>
        <s-button>View All Trade-Ins</s-button>
      </Link>

      {/* Quick Stats */}
      <s-section heading="Overview">
        <s-stack direction="inline" gap="large">
          <Link to="/app/trade-ins?status=SUBMITTED" style={{ textDecoration: "none", flex: 1 }}>
            <s-box padding="large" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="tight">
                <s-text tone="subdued">Pending Arrival</s-text>
                <s-text variant="headingLg">
                  <strong>{stats.pendingSubmissions}</strong>
                </s-text>
              </s-stack>
            </s-box>
          </Link>

          <Link to="/app/trade-ins?status=GRADING" style={{ textDecoration: "none", flex: 1 }}>
            <s-box padding="large" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="tight">
                <s-text tone="subdued">Needs Grading</s-text>
                <s-text variant="headingLg">
                  <strong>{stats.gradingSubmissions}</strong>
                </s-text>
              </s-stack>
            </s-box>
          </Link>

          <Link to="/app/trade-ins?status=PENDING_APPROVAL" style={{ textDecoration: "none", flex: 1 }}>
            <s-box padding="large" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="tight">
                <s-text tone="subdued">Awaiting Approval</s-text>
                <s-text variant="headingLg">
                  <strong>{stats.approvalSubmissions}</strong>
                </s-text>
              </s-stack>
            </s-box>
          </Link>

          <s-box padding="large" background="subdued" borderRadius="base" style={{ flex: 1 }}>
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Completed This Week</s-text>
              <s-text variant="headingLg">
                <strong>{stats.completedThisWeek}</strong>
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Value Summary */}
      <s-section heading="Value Summary">
        <s-stack direction="inline" gap="large">
          <s-box padding="large" borderWidth="base" borderRadius="base" style={{ flex: 1 }}>
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Pending Trade-In Value</s-text>
              <s-text variant="headingLg">
                <strong>{formatPrice(stats.totalPendingValue)}</strong>
              </s-text>
              <s-text tone="subdued">Across active submissions</s-text>
            </s-stack>
          </s-box>

          <s-box padding="large" borderWidth="base" borderRadius="base" style={{ flex: 1 }}>
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Total Completed Value</s-text>
              <s-text variant="headingLg">
                <strong>{formatPrice(stats.totalCompletedValue)}</strong>
              </s-text>
              <s-text tone="subdued">All time payouts</s-text>
            </s-stack>
          </s-box>

          <Link to="/app/prices" style={{ textDecoration: "none", flex: 1 }}>
            <s-box padding="large" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="tight">
                <s-text tone="subdued">Active Cards in Price List</s-text>
                <s-text variant="headingLg">
                  <strong>{stats.totalActiveCards}</strong>
                </s-text>
                <s-text tone="subdued">Click to manage</s-text>
              </s-stack>
            </s-box>
          </Link>
        </s-stack>
      </s-section>

      {/* Quick Actions */}
      <s-section heading="Quick Actions">
        <s-stack direction="inline" gap="base">
          <Link to="/app/prices?source=api" style={{ textDecoration: "none" }}>
            <s-button variant="secondary">Search Card Prices</s-button>
          </Link>
          <Link to="/app/buylist" style={{ textDecoration: "none" }}>
            <s-button variant="secondary">Manage Buylist</s-button>
          </Link>
          <Link to="/app/inventory" style={{ textDecoration: "none" }}>
            <s-button variant="secondary">View Inventory</s-button>
          </Link>
          <Link to="/app/settings" style={{ textDecoration: "none" }}>
            <s-button variant="tertiary">Settings</s-button>
          </Link>
        </s-stack>
      </s-section>

      {/* Recent Submissions */}
      <s-section heading="Recent Submissions">
        {recentSubmissions.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>No trade-in submissions yet</strong>
              </s-text>
              <s-paragraph>
                Trade-in submissions from customers will appear here once they start
                using your trade-in system.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <>
            {recentSubmissions.map((submission) => (
              <Link
                key={submission.id}
                to={`/app/trade-ins/${submission.id}`}
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <s-box padding="base" borderBlockEndWidth="base">
                  <s-stack direction="inline" gap="large">
                    <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                      <s-stack direction="inline" gap="tight">
                        <s-text>
                          <strong>#{submission.submissionNumber}</strong>
                        </s-text>
                        <s-badge tone={statusColors[submission.status]}>
                          {submission.status.replace(/_/g, " ")}
                        </s-badge>
                      </s-stack>
                      <s-text tone="subdued">
                        {submission.customer.firstName} {submission.customer.lastName}
                      </s-text>
                    </s-stack>
                    <s-stack direction="block" gap="tight">
                      <s-text>
                        <strong>{formatPrice(submission.quotedTotal)}</strong>
                      </s-text>
                      <s-text tone="subdued">
                        {submission.items.length} items
                      </s-text>
                    </s-stack>
                    <s-text tone="subdued">{formatDate(submission.createdAt)}</s-text>
                  </s-stack>
                </s-box>
              </Link>
            ))}
            <s-box paddingBlockStart="base">
              <Link to="/app/trade-ins" style={{ textDecoration: "none" }}>
                <s-button variant="tertiary">View All Submissions</s-button>
              </Link>
            </s-box>
          </>
        )}
      </s-section>

      {/* Sidebar - Getting Started */}
      <s-section slot="aside" heading="Getting Started">
        <s-stack direction="block" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>
                <strong>1. Set Up Prices</strong>
              </s-text>
              <s-paragraph>
                Sync card prices from the external API or add them manually.
              </s-paragraph>
              <Link to="/app/prices" style={{ textDecoration: "none" }}>
                <s-button variant="tertiary">Manage Prices</s-button>
              </Link>
            </s-stack>
          </s-box>

          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>
                <strong>2. Configure Buylist</strong>
              </s-text>
              <s-paragraph>
                Set which cards you're actively buying and at what rates.
              </s-paragraph>
              <Link to="/app/buylist" style={{ textDecoration: "none" }}>
                <s-button variant="tertiary">Manage Buylist</s-button>
              </Link>
            </s-stack>
          </s-box>

          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>
                <strong>3. Adjust Settings</strong>
              </s-text>
              <s-paragraph>
                Set minimum values, bonus rates, and shipping options.
              </s-paragraph>
              <Link to="/app/settings" style={{ textDecoration: "none" }}>
                <s-button variant="tertiary">Settings</s-button>
              </Link>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Sidebar - Help */}
      <s-section slot="aside" heading="Need Help?">
        <s-unordered-list>
          <s-list-item>
            <s-link href="#" target="_blank">
              Trade-In Grading Guide
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="#" target="_blank">
              Managing Payouts
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="#" target="_blank">
              Customer Communication
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
