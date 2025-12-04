import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
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
  await authenticate.admin(request);

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

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600 }}>
            Trade-In Dashboard
          </h1>
          <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
            Manage your card trade-in submissions
          </p>
        </div>
        <Link
          to="/app/trade-ins"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "10px 16px",
            background: "#000",
            color: "#fff",
            borderRadius: "6px",
            textDecoration: "none",
            fontSize: "14px",
            fontWeight: 500,
          }}
        >
          View All Submissions
        </Link>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          {alerts.map((alert, index) => (
            <AlertCard key={index} alert={alert} />
          ))}
        </div>
      )}

      {/* Stats Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        <StatCard
          title="Pending Arrival"
          value={stats.pendingArrival}
          color="#3b82f6"
          link="/app/trade-ins?status=SUBMITTED,IN_TRANSIT"
        />
        <StatCard
          title="Needs Grading"
          value={stats.needsGrading}
          color="#f59e0b"
          link="/app/trade-ins?status=RECEIVED,GRADING"
        />
        <StatCard
          title="Awaiting Approval"
          value={stats.awaitingApproval}
          color="#8b5cf6"
          link="/app/trade-ins?status=PENDING_APPROVAL"
        />
        <StatCard
          title="Completed This Week"
          value={stats.completedThisWeek}
          color="#10b981"
          link="/app/trade-ins?status=COMPLETED"
        />
      </div>

      {/* Value Summary */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        <ValueCard
          title="Pending Trade-In Value"
          value={formatPrice(stats.totalPendingValue)}
          subtitle="Across active submissions"
        />
        <ValueCard
          title="Total Completed Payouts"
          value={formatPrice(stats.totalCompletedValue)}
          subtitle="All time"
        />
        <Link to="/app/prices" style={{ textDecoration: "none" }}>
          <ValueCard
            title="Active Cards in Price List"
            value={stats.totalActiveCards.toLocaleString()}
            subtitle="Click to manage"
            clickable
          />
        </Link>
      </div>

      {/* Recent Submissions */}
      <div
        style={{
          background: "#fff",
          borderRadius: "8px",
          border: "1px solid #e5e7eb",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
            Recent Activity
          </h2>
          <Link
            to="/app/trade-ins"
            style={{ color: "#3b82f6", fontSize: "14px", textDecoration: "none" }}
          >
            View all →
          </Link>
        </div>

        {recentSubmissions.length === 0 ? (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "#6b7280",
            }}
          >
            <p style={{ margin: 0, fontSize: "16px" }}>No submissions yet</p>
            <p style={{ margin: "8px 0 0", fontSize: "14px" }}>
              Trade-in submissions will appear here once customers start
              submitting.
            </p>
          </div>
        ) : (
          <div>
            {recentSubmissions.map((submission) => (
              <Link
                key={submission.id}
                to={`/app/trade-ins/${submission.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div
                  style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid #e5e7eb",
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 100px",
                    alignItems: "center",
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#f9fafb")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <strong style={{ fontFamily: "monospace" }}>
                        {submission.submissionNumber}
                      </strong>
                      <StatusBadge status={submission.status} />
                    </div>
                    <div
                      style={{
                        color: "#6b7280",
                        fontSize: "14px",
                        marginTop: "4px",
                      }}
                    >
                      {submission.customerName}
                    </div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 600 }}>
                      {formatPrice(submission.quotedTotal)}
                    </div>
                    <div style={{ color: "#6b7280", fontSize: "13px" }}>
                      {submission.itemCount} item
                      {submission.itemCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div
                    style={{
                      color: "#6b7280",
                      fontSize: "14px",
                      textAlign: "center",
                    }}
                  >
                    {formatDate(submission.createdAt)}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span
                      style={{
                        color: "#3b82f6",
                        fontSize: "14px",
                      }}
                    >
                      View →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div
        style={{
          marginTop: "32px",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "16px",
        }}
      >
        <QuickActionCard
          title="Price Management"
          description="Update trade-in prices and add new cards"
          link="/app/prices"
          icon="💰"
        />
        <QuickActionCard
          title="Settings"
          description="Configure multipliers, thresholds, and notifications"
          link="/app/settings"
          icon="⚙️"
        />
        <QuickActionCard
          title="Reports"
          description="View analytics and export data"
          link="/app/reports"
          icon="📊"
        />
      </div>
    </div>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const colors = {
    warning: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
    info: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
    critical: { bg: "#fee2e2", border: "#ef4444", text: "#991b1b" },
  };

  const color = colors[alert.type];

  return (
    <div
      style={{
        padding: "16px",
        background: color.bg,
        borderLeft: `4px solid ${color.border}`,
        borderRadius: "4px",
        marginBottom: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={{ fontWeight: 600, color: color.text }}>{alert.title}</div>
          <div style={{ fontSize: "14px", color: color.text, marginTop: "4px" }}>
            {alert.message}
          </div>
        </div>
        {alert.link && (
          <Link
            to={alert.link}
            style={{
              color: color.text,
              fontSize: "14px",
              fontWeight: 500,
              textDecoration: "underline",
              whiteSpace: "nowrap",
            }}
          >
            {alert.linkText}
          </Link>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  color,
  link,
}: {
  title: string;
  value: number;
  color: string;
  link?: string;
}) {
  const content = (
    <div
      style={{
        background: "#fff",
        borderRadius: "8px",
        padding: "20px",
        border: "1px solid #e5e7eb",
        borderLeft: `4px solid ${color}`,
        cursor: link ? "pointer" : "default",
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        if (link) e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(0,0,0,0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ color: "#6b7280", fontSize: "14px", marginBottom: "8px" }}>
        {title}
      </div>
      <div style={{ fontSize: "32px", fontWeight: 700, color: "#111827" }}>
        {value}
      </div>
    </div>
  );

  if (link) {
    return (
      <Link to={link} style={{ textDecoration: "none" }}>
        {content}
      </Link>
    );
  }

  return content;
}

function ValueCard({
  title,
  value,
  subtitle,
  clickable = false,
}: {
  title: string;
  value: string;
  subtitle: string;
  clickable?: boolean;
}) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "8px",
        padding: "20px",
        border: "1px solid #e5e7eb",
        cursor: clickable ? "pointer" : "default",
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        if (clickable) e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(0,0,0,0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ color: "#6b7280", fontSize: "14px", marginBottom: "8px" }}>
        {title}
      </div>
      <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>
        {value}
      </div>
      <div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "4px" }}>
        {subtitle}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: "#f3f4f6", text: "#6b7280" },
    SUBMITTED: { bg: "#dbeafe", text: "#1d4ed8" },
    IN_TRANSIT: { bg: "#dbeafe", text: "#1d4ed8" },
    RECEIVED: { bg: "#fef3c7", text: "#b45309" },
    GRADING: { bg: "#fef3c7", text: "#b45309" },
    PENDING_APPROVAL: { bg: "#ede9fe", text: "#7c3aed" },
    APPROVED: { bg: "#d1fae5", text: "#059669" },
    COMPLETED: { bg: "#d1fae5", text: "#059669" },
    CANCELLED: { bg: "#fee2e2", text: "#dc2626" },
    RETURNED: { bg: "#fee2e2", text: "#dc2626" },
  };

  const color = colors[status] || colors.DRAFT;
  const label =
    SubmissionStatusLabels[status as keyof typeof SubmissionStatusLabels] ||
    status.replace(/_/g, " ");

  return (
    <span
      style={{
        background: color.bg,
        color: color.text,
        padding: "2px 8px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: 500,
      }}
    >
      {label}
    </span>
  );
}

function QuickActionCard({
  title,
  description,
  link,
  icon,
}: {
  title: string;
  description: string;
  link: string;
  icon: string;
}) {
  return (
    <Link to={link} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: "#fff",
          borderRadius: "8px",
          padding: "20px",
          border: "1px solid #e5e7eb",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(0,0,0,0.1)";
          e.currentTarget.style.borderColor = "#d1d5db";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = "none";
          e.currentTarget.style.borderColor = "#e5e7eb";
        }}
      >
        <div style={{ fontSize: "24px", marginBottom: "12px" }}>{icon}</div>
        <div style={{ fontWeight: 600, marginBottom: "4px", color: "#111827" }}>
          {title}
        </div>
        <div style={{ fontSize: "14px", color: "#6b7280" }}>{description}</div>
      </div>
    </Link>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
