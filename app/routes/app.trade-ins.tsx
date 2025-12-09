import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link, useSearchParams, useNavigate } from "react-router";
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
import "../styles/admin-trade-ins.css";

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
    <div className="admin-trade-ins">
      {/* Header */}
      <div className="admin-trade-ins__header">
        <div>
          <h1 className="admin-trade-ins__title">Trade-In Submissions</h1>
          <p className="admin-trade-ins__subtitle">
            {pagination.totalCount} submission{pagination.totalCount !== 1 ? "s" : ""}
          </p>
        </div>
        <Link to="/app" className="admin-trade-ins__back-link">
          ← Back to Dashboard
        </Link>
      </div>

      {/* Filters Card */}
      <div className="admin-card admin-card--flush" style={{ marginBottom: 16 }}>
        {/* Status Tabs */}
        <div className="admin-tabs">
          {statusTabs.map((tab) => (
            <button
              key={tab.key || "all"}
              onClick={() => handleStatusFilter(tab.key)}
              className={`admin-tabs__tab ${filters.status === tab.key ? "admin-tabs__tab--active" : ""}`}
            >
              {tab.label}
              <span className="admin-tabs__badge">{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Search and Sort */}
        <div className="admin-filters">
          <form onSubmit={handleSearch} className="admin-search">
            <input
              type="text"
              name="search"
              placeholder="Search by submission #, customer name, or email..."
              defaultValue={filters.search || ""}
              className="admin-search__input"
            />
            <button type="submit" className="admin-btn admin-btn--secondary">
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
                className="admin-btn admin-btn--link"
              >
                Clear
              </button>
            )}
          </form>

          <select
            value={filters.sort}
            onChange={(e) => handleSort(e.target.value)}
            className="admin-select"
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
      <div className="admin-card admin-card--flush">
        {submissions.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">No submissions found</p>
            <p className="admin-empty__desc">
              {filters.search || filters.status
                ? "Try adjusting your filters"
                : "Submissions will appear here once customers submit trade-ins"}
            </p>
          </div>
        ) : (
          <div className="admin-table">
            {/* Table Header */}
            <div className="admin-table__header">
              <div>Submission</div>
              <div>Customer</div>
              <div>Status</div>
              <div className="admin-table__cell--right">Value</div>
              <div className="admin-table__cell--center">Items</div>
              <div></div>
            </div>

            {/* Table Body */}
            {submissions.map((submission) => (
              <div
                key={submission.id}
                onClick={() => {
                  console.log("[trade-ins] Navigating to submission:", submission.id);
                  navigate(`/app/trade-ins/${submission.id}`);
                }}
                className="admin-table__row"
              >
                {/* Submission Info */}
                <div className="admin-table__cell">
                  <div className="admin-submission-info">
                    <span className="admin-submission-info__number">
                      {submission.submissionNumber}
                      {submission.daysSinceReceived !== null &&
                        submission.daysSinceReceived > 3 &&
                        ["RECEIVED", "GRADING"].includes(submission.status) && (
                          <span className="admin-submission-info__alert">
                            {submission.daysSinceReceived}d
                          </span>
                        )}
                    </span>
                    <span className="admin-submission-info__date">
                      {formatDate(submission.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Customer */}
                <div className="admin-table__cell">
                  <div className="admin-customer-info">
                    <span className="admin-customer-info__name">
                      {submission.customerName}
                    </span>
                    <span className="admin-customer-info__payout">
                      {submission.payoutType.replace("_", " ")}
                    </span>
                  </div>
                </div>

                {/* Status */}
                <div className="admin-table__cell">
                  <StatusBadge status={submission.status} />
                </div>

                {/* Value */}
                <div className="admin-table__cell admin-table__cell--right">
                  <div className="admin-value">
                    <div className="admin-value__current">
                      {formatPrice(submission.finalTotal ?? submission.quotedTotal)}
                    </div>
                    {submission.finalTotal !== null &&
                      submission.finalTotal !== submission.quotedTotal && (
                        <div className="admin-value__original">
                          {formatPrice(submission.quotedTotal)}
                        </div>
                      )}
                  </div>
                </div>

                {/* Items */}
                <div className="admin-table__cell admin-table__cell--center">
                  {submission.itemCount}
                </div>

                {/* Action */}
                <div className="admin-table__cell admin-table__cell--right">
                  <span className="admin-view-link">View →</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="admin-pagination">
          <div className="admin-pagination__info">
            Showing {(pagination.page - 1) * ITEMS_PER_PAGE + 1} -{" "}
            {Math.min(pagination.page * ITEMS_PER_PAGE, pagination.totalCount)} of{" "}
            {pagination.totalCount}
          </div>

          <div className="admin-pagination__controls">
            <button
              disabled={!pagination.hasPrevPage}
              onClick={() => handlePageChange(pagination.page - 1)}
              className="admin-btn admin-btn--secondary"
            >
              Previous
            </button>

            <span className="admin-pagination__page">
              Page {pagination.page} of {pagination.totalPages}
            </span>

            <button
              disabled={!pagination.hasNextPage}
              onClick={() => handlePageChange(pagination.page + 1)}
              className="admin-btn admin-btn--secondary"
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
  const label =
    SubmissionStatusLabels[status as keyof typeof SubmissionStatusLabels] ||
    status.replace(/_/g, " ");

  return (
    <span className={`admin-badge admin-badge--${status.toLowerCase()}`}>
      {label}
    </span>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
