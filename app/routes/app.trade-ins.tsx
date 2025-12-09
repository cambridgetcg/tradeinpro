import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link, useSearchParams, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import {
  SubmissionStatus,
  SubmissionStatusLabels,
  type SubmissionStatusType,
  formatPrice,
} from "../lib/constants";

const ITEMS_PER_PAGE = 20;

interface Submission {
  id: string;
  submissionNumber: string;
  status: string;
  customerName: string;
  customerEmail: string;
  quotedTotal: number;
  finalTotal: number | null;
  itemCount: number;
  payoutType: string;
  createdAt: string;
  submittedAt: string | null;
  receivedAt: string | null;
  daysSinceReceived: number | null;
}

interface LoaderData {
  submissions: Submission[];
  pagination: {
    page: number;
    totalPages: number;
    totalCount: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  filters: {
    status: string | null;
    search: string | null;
    sort: string;
  };
  statusCounts: Record<string, number>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");
  const sort = url.searchParams.get("sort") || "newest";

  // Build where clause
  const where: Prisma.TradeInSubmissionWhereInput = {
    // Exclude drafts by default
    status: { not: SubmissionStatus.DRAFT },
  };

  // Status filter (can be comma-separated for multiple statuses)
  if (status) {
    const statuses = status.split(",").filter(s =>
      Object.values(SubmissionStatus).includes(s as SubmissionStatusType)
    );
    if (statuses.length === 1) {
      where.status = statuses[0];
    } else if (statuses.length > 1) {
      where.status = { in: statuses };
    }
  }

  // Search filter
  if (search) {
    where.OR = [
      { submissionNumber: { contains: search, mode: "insensitive" } },
      { customer: { email: { contains: search, mode: "insensitive" } } },
      { customer: { firstName: { contains: search, mode: "insensitive" } } },
      { customer: { lastName: { contains: search, mode: "insensitive" } } },
    ];
  }

  // Build orderBy
  let orderBy: Prisma.TradeInSubmissionOrderByWithRelationInput;
  switch (sort) {
    case "oldest":
      orderBy = { createdAt: "asc" };
      break;
    case "value-high":
      orderBy = { quotedTotal: "desc" };
      break;
    case "value-low":
      orderBy = { quotedTotal: "asc" };
      break;
    case "received":
      orderBy = { receivedAt: "desc" };
      break;
    default:
      orderBy = { createdAt: "desc" };
  }

  // Fetch submissions with pagination
  const [submissions, totalCount, statusCounts] = await Promise.all([
    prisma.tradeInSubmission.findMany({
      where,
      orderBy,
      skip: (page - 1) * ITEMS_PER_PAGE,
      take: ITEMS_PER_PAGE,
      include: {
        customer: {
          select: { firstName: true, lastName: true, email: true },
        },
        _count: { select: { items: true } },
      },
    }),

    prisma.tradeInSubmission.count({ where }),

    // Get counts for each status (for filter badges)
    prisma.tradeInSubmission.groupBy({
      by: ["status"],
      where: { status: { not: SubmissionStatus.DRAFT } },
      _count: { status: true },
    }),
  ]);

  // Transform status counts
  const statusCountsMap: Record<string, number> = {};
  for (const item of statusCounts) {
    statusCountsMap[item.status] = item._count.status;
  }

  // Calculate days since received for each submission
  const now = new Date();
  const formattedSubmissions: Submission[] = submissions.map((sub) => {
    let daysSinceReceived: number | null = null;
    if (sub.receivedAt) {
      daysSinceReceived = Math.floor(
        (now.getTime() - sub.receivedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return {
      id: sub.id,
      submissionNumber: sub.submissionNumber,
      status: sub.status,
      customerName: sub.customer
        ? `${sub.customer.firstName || ""} ${sub.customer.lastName || ""}`.trim() ||
          sub.customer.email
        : "Unknown",
      customerEmail: sub.customer?.email || "",
      quotedTotal: sub.quotedTotal,
      finalTotal: sub.finalTotal,
      itemCount: sub._count.items,
      payoutType: sub.payoutType,
      createdAt: sub.createdAt.toISOString(),
      submittedAt: sub.submittedAt?.toISOString() || null,
      receivedAt: sub.receivedAt?.toISOString() || null,
      daysSinceReceived,
    };
  });

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return {
    submissions: formattedSubmissions,
    pagination: {
      page,
      totalPages,
      totalCount,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    filters: {
      status,
      search,
      sort,
    },
    statusCounts: statusCountsMap,
  } satisfies LoaderData;
};

export default function TradeIns() {
  const { submissions, pagination, filters, statusCounts } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const handleStatusFilter = (status: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (status) {
      params.set("status", status);
    } else {
      params.delete("status");
    }
    params.set("page", "1");
    setSearchParams(params);
  };

  const handleSort = (sort: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("sort", sort);
    params.set("page", "1");
    setSearchParams(params);
  };

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const search = formData.get("search") as string;
    const params = new URLSearchParams(searchParams);
    if (search) {
      params.set("search", search);
    } else {
      params.delete("search");
    }
    params.set("page", "1");
    setSearchParams(params);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  // Status filter tabs
  const statusTabs = [
    { key: null, label: "All", count: Object.values(statusCounts).reduce((a, b) => a + b, 0) },
    { key: "SUBMITTED,IN_TRANSIT", label: "Pending", count: (statusCounts.SUBMITTED || 0) + (statusCounts.IN_TRANSIT || 0) },
    { key: "RECEIVED,GRADING", label: "Grading", count: (statusCounts.RECEIVED || 0) + (statusCounts.GRADING || 0) },
    { key: "PENDING_APPROVAL", label: "Approval", count: statusCounts.PENDING_APPROVAL || 0 },
    { key: "APPROVED", label: "Approved", count: statusCounts.APPROVED || 0 },
    { key: "COMPLETED", label: "Completed", count: statusCounts.COMPLETED || 0 },
  ];

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
            Trade-In Submissions
          </h1>
          <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
            {pagination.totalCount} submission
            {pagination.totalCount !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          to="/app"
          style={{
            color: "#3b82f6",
            textDecoration: "none",
            fontSize: "14px",
          }}
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Filters Bar */}
      <div
        style={{
          background: "#fff",
          borderRadius: "8px",
          border: "1px solid #e5e7eb",
          marginBottom: "16px",
        }}
      >
        {/* Status Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e5e7eb",
            overflow: "auto",
          }}
        >
          {statusTabs.map((tab) => (
            <button
              key={tab.key || "all"}
              onClick={() => handleStatusFilter(tab.key)}
              style={{
                padding: "12px 20px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 500,
                color: filters.status === tab.key ? "#3b82f6" : "#6b7280",
                borderBottom:
                  filters.status === tab.key ? "2px solid #3b82f6" : "2px solid transparent",
                marginBottom: "-1px",
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: "8px",
                  padding: "2px 8px",
                  background: filters.status === tab.key ? "#dbeafe" : "#f3f4f6",
                  borderRadius: "10px",
                  fontSize: "12px",
                  color: filters.status === tab.key ? "#1d4ed8" : "#6b7280",
                }}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search and Sort */}
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            gap: "16px",
            alignItems: "center",
          }}
        >
          <form onSubmit={handleSearch} style={{ flex: 1, display: "flex", gap: "8px" }}>
            <input
              type="text"
              name="search"
              placeholder="Search by submission #, customer name, or email..."
              defaultValue={filters.search || ""}
              style={{
                flex: 1,
                padding: "8px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                fontSize: "14px",
              }}
            />
            <button
              type="submit"
              style={{
                padding: "8px 16px",
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              Search
            </button>
            {filters.search && (
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  params.delete("search");
                  setSearchParams(params);
                }}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "14px",
                  color: "#ef4444",
                }}
              >
                Clear
              </button>
            )}
          </form>

          <select
            value={filters.sort}
            onChange={(e) => handleSort(e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              fontSize: "14px",
              background: "#fff",
            }}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="value-high">Highest Value</option>
            <option value="value-low">Lowest Value</option>
            <option value="received">Recently Received</option>
          </select>
        </div>
      </div>

      {/* Submissions Table */}
      <div
        style={{
          background: "#fff",
          borderRadius: "8px",
          border: "1px solid #e5e7eb",
          overflow: "hidden",
        }}
      >
        {submissions.length === 0 ? (
          <div
            style={{
              padding: "60px 20px",
              textAlign: "center",
              color: "#6b7280",
            }}
          >
            <p style={{ margin: 0, fontSize: "16px" }}>No submissions found</p>
            <p style={{ margin: "8px 0 0", fontSize: "14px" }}>
              {filters.search || filters.status
                ? "Try adjusting your filters"
                : "Submissions will appear here once customers submit trade-ins"}
            </p>
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 1fr 1fr 100px 100px 80px",
                padding: "12px 20px",
                background: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
                fontSize: "12px",
                fontWeight: 600,
                color: "#6b7280",
                textTransform: "uppercase",
              }}
            >
              <div>Submission</div>
              <div>Customer</div>
              <div>Status</div>
              <div style={{ textAlign: "right" }}>Value</div>
              <div style={{ textAlign: "center" }}>Items</div>
              <div></div>
            </div>

            {/* Table Body */}
            {submissions.map((submission) => (
              <div
                key={submission.id}
                onClick={() => {
                  console.log('[trade-ins] Navigating to submission:', submission.id);
                  // Use React Router navigate - App Bridge should handle embedded navigation
                  navigate(`/app/trade-ins/${submission.id}`);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr 1fr 1fr 100px 100px 80px",
                  padding: "16px 20px",
                  borderBottom: "1px solid #e5e7eb",
                  alignItems: "center",
                  cursor: "pointer",
                  transition: "background 0.15s",
                  textDecoration: "none",
                  color: "inherit",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                  {/* Submission Info */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ fontFamily: "monospace", fontSize: "14px" }}>
                        {submission.submissionNumber}
                      </strong>
                      {submission.daysSinceReceived !== null &&
                        submission.daysSinceReceived > 3 &&
                        ["RECEIVED", "GRADING"].includes(submission.status) && (
                          <span
                            style={{
                              background: "#fef3c7",
                              color: "#b45309",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontSize: "10px",
                              fontWeight: 500,
                            }}
                          >
                            {submission.daysSinceReceived}d
                          </span>
                        )}
                    </div>
                    <div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "4px" }}>
                      {formatDate(submission.createdAt)}
                    </div>
                  </div>

                  {/* Customer */}
                  <div>
                    <div style={{ fontSize: "14px" }}>{submission.customerName}</div>
                    <div style={{ color: "#9ca3af", fontSize: "12px" }}>
                      {submission.payoutType.replace("_", " ")}
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <StatusBadge status={submission.status} />
                  </div>

                  {/* Value */}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600, fontSize: "14px" }}>
                      {formatPrice(submission.finalTotal ?? submission.quotedTotal)}
                    </div>
                    {submission.finalTotal !== null &&
                      submission.finalTotal !== submission.quotedTotal && (
                        <div
                          style={{
                            color: "#9ca3af",
                            fontSize: "12px",
                            textDecoration: "line-through",
                          }}
                        >
                          {formatPrice(submission.quotedTotal)}
                        </div>
                      )}
                  </div>

                  {/* Items */}
                  <div style={{ textAlign: "center", color: "#6b7280", fontSize: "14px" }}>
                    {submission.itemCount}
                  </div>

                  {/* Action */}
                  <div style={{ textAlign: "right" }}>
                    <span style={{ color: "#3b82f6", fontSize: "14px" }}>View →</span>
                  </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div
          style={{
            marginTop: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ color: "#6b7280", fontSize: "14px" }}>
            Showing {(pagination.page - 1) * ITEMS_PER_PAGE + 1} -{" "}
            {Math.min(pagination.page * ITEMS_PER_PAGE, pagination.totalCount)} of{" "}
            {pagination.totalCount}
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              disabled={!pagination.hasPrevPage}
              onClick={() => handlePageChange(pagination.page - 1)}
              style={{
                padding: "8px 16px",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                background: pagination.hasPrevPage ? "#fff" : "#f9fafb",
                cursor: pagination.hasPrevPage ? "pointer" : "not-allowed",
                fontSize: "14px",
                color: pagination.hasPrevPage ? "#111827" : "#9ca3af",
              }}
            >
              Previous
            </button>

            <span
              style={{
                padding: "8px 16px",
                fontSize: "14px",
                color: "#6b7280",
              }}
            >
              Page {pagination.page} of {pagination.totalPages}
            </span>

            <button
              disabled={!pagination.hasNextPage}
              onClick={() => handlePageChange(pagination.page + 1)}
              style={{
                padding: "8px 16px",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                background: pagination.hasNextPage ? "#fff" : "#f9fafb",
                cursor: pagination.hasNextPage ? "pointer" : "not-allowed",
                fontSize: "14px",
                color: pagination.hasNextPage ? "#111827" : "#9ca3af",
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
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
        padding: "4px 10px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: 500,
        display: "inline-block",
      }}
    >
      {label}
    </span>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
