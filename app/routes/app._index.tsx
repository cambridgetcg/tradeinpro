import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // Mock data - no database queries
  return {
    stats: {
      pendingSubmissions: 3,
      gradingSubmissions: 5,
      approvalSubmissions: 2,
      completedThisWeek: 12,
      totalActiveCards: 1547,
      totalPendingValue: 15000,
      totalCompletedValue: 245000,
    },
    recentSubmissions: [
      {
        id: "mock-1",
        submissionNumber: "TRD-001",
        status: "GRADING",
        customer: { firstName: "John", lastName: "Smith" },
        quotedTotal: 4500,
        items: [{ id: "1" }, { id: "2" }, { id: "3" }],
        createdAt: new Date().toISOString(),
      },
      {
        id: "mock-2",
        submissionNumber: "TRD-002",
        status: "PENDING_APPROVAL",
        customer: { firstName: "Sarah", lastName: "Jones" },
        quotedTotal: 8900,
        items: [{ id: "1" }, { id: "2" }],
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: "mock-3",
        submissionNumber: "TRD-003",
        status: "COMPLETED",
        customer: { firstName: "Mike", lastName: "Brown" },
        quotedTotal: 2100,
        items: [{ id: "1" }],
        createdAt: new Date(Date.now() - 172800000).toISOString(),
      },
    ],
  };
};

const statusColors: Record<string, string> = {
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
    <div style={{ padding: "20px", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600 }}>Trade-In Dashboard</h1>
        <p style={{ margin: "8px 0 0", color: "#6b7280" }}>Manage your card trade-in submissions</p>
      </div>

      {/* Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
        <StatCard title="Pending Arrival" value={stats.pendingSubmissions} color="#3b82f6" />
        <StatCard title="Needs Grading" value={stats.gradingSubmissions} color="#f59e0b" />
        <StatCard title="Awaiting Approval" value={stats.approvalSubmissions} color="#8b5cf6" />
        <StatCard title="Completed This Week" value={stats.completedThisWeek} color="#10b981" />
      </div>

      {/* Value Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "32px" }}>
        <ValueCard
          title="Pending Trade-In Value"
          value={formatPrice(stats.totalPendingValue)}
          subtitle="Across active submissions"
        />
        <ValueCard
          title="Total Completed Value"
          value={formatPrice(stats.totalCompletedValue)}
          subtitle="All time payouts"
        />
        <ValueCard
          title="Active Cards in Price List"
          value={stats.totalActiveCards.toLocaleString()}
          subtitle="Click to manage"
        />
      </div>

      {/* Recent Submissions */}
      <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Recent Submissions</h2>
        </div>
        <div>
          {recentSubmissions.map((submission) => (
            <div
              key={submission.id}
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <strong>#{submission.submissionNumber}</strong>
                  <StatusBadge status={submission.status} />
                </div>
                <div style={{ color: "#6b7280", fontSize: "14px", marginTop: "4px" }}>
                  {submission.customer.firstName} {submission.customer.lastName}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 600 }}>{formatPrice(submission.quotedTotal)}</div>
                <div style={{ color: "#6b7280", fontSize: "14px" }}>
                  {submission.items.length} items
                </div>
              </div>
              <div style={{ color: "#6b7280", fontSize: "14px" }}>
                {formatDate(submission.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: "8px",
      padding: "20px",
      border: "1px solid #e5e7eb",
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ color: "#6b7280", fontSize: "14px", marginBottom: "8px" }}>{title}</div>
      <div style={{ fontSize: "32px", fontWeight: 700, color: "#111827" }}>{value}</div>
    </div>
  );
}

function ValueCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: "8px",
      padding: "20px",
      border: "1px solid #e5e7eb",
    }}>
      <div style={{ color: "#6b7280", fontSize: "14px", marginBottom: "8px" }}>{title}</div>
      <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>{value}</div>
      <div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "4px" }}>{subtitle}</div>
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

  return (
    <span style={{
      background: color.bg,
      color: color.text,
      padding: "2px 8px",
      borderRadius: "4px",
      fontSize: "12px",
      fontWeight: 500,
    }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
