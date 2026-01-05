/**
 * Customer Submissions List API
 *
 * GET /apps/trade-in/my-submissions
 *
 * Returns all trade-in submissions for the logged-in customer.
 * Requires customer authentication via App Proxy.
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import prisma from "../db.server";
import {
  SubmissionStatus,
  SubmissionStatusLabels,
  type SubmissionStatusType,
} from "../lib/constants";

// ============================================================================
// Types
// ============================================================================

interface SubmissionSummary {
  id: string;
  submissionNumber: string;
  status: string;
  statusLabel: string;
  itemCount: number;
  quotedTotal: number;
  finalTotal: number | null;
  payoutType: string;
  payoutTypeLabel: string;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  // Quick action flags
  canDownloadPackingSlip: boolean;
  canViewShippingInstructions: boolean;
  needsReview: boolean;
  isComplete: boolean;
}

interface CustomerStats {
  total: number;
  pending: number;
  completed: number;
  totalEarned: number;
}

interface CustomerSubmissionsResponse {
  submissions: SubmissionSummary[];
  stats: CustomerStats;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

// ============================================================================
// Status Helpers
// ============================================================================

const PAYOUT_TYPE_LABELS: Record<string, string> = {
  STORE_CREDIT: "Store Credit",
  BANK: "Bank Transfer",
};

const PENDING_STATUSES = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.IN_TRANSIT,
  SubmissionStatus.RECEIVED,
  SubmissionStatus.GRADING,
  SubmissionStatus.PENDING_APPROVAL,
  SubmissionStatus.APPROVED,
];

const COMPLETED_STATUSES = [SubmissionStatus.COMPLETED];

// ============================================================================
// Loader
// ============================================================================

export async function loader({ request }: LoaderFunctionArgs) {
  // Debug: Log request info
  const url = new URL(request.url);
  console.log('[my-submissions] Request received:', {
    url: url.pathname,
    hasSignature: url.searchParams.has('signature'),
    hasLoggedInCustomerId: url.searchParams.has('logged_in_customer_id'),
    loggedInCustomerId: url.searchParams.get('logged_in_customer_id'),
  });

  // Require logged-in customer
  let context;
  try {
    context = await requireCustomer(request);
  } catch (response) {
    // In development, allow bypassing auth for testing
    if (process.env.NODE_ENV !== "production") {
      const url = new URL(request.url);
      const testCustomerId = url.searchParams.get("_test_customer_id");
      if (testCustomerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: testCustomerId },
        });
        if (customer) {
          context = {
            isValid: true,
            shop: "test",
            customerId: customer.shopifyCustomerId || "test",
            internalCustomerId: customer.id,
            locale: "en",
            timestamp: "",
            path_prefix: "",
          };
        }
      }
    }
    if (!context) {
      return response as Response;
    }
  }

  // Debug: Log customer context
  console.log('[my-submissions] Customer context:', {
    shopifyCustomerId: context.customerId,
    internalCustomerId: context.internalCustomerId,
    shop: context.shop,
  });

  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const limit = Math.min(parsePositiveInt(url.searchParams.get("limit"), 20), 50);
  const status = url.searchParams.get("status"); // Optional filter

  try {
    // Build where clause
    const where: {
      customerId: string;
      status?: { in: string[] } | string;
    } = {
      customerId: context.internalCustomerId,
    };

    // Filter by status if provided
    if (status) {
      if (status === "pending") {
        where.status = { in: PENDING_STATUSES };
      } else if (status === "completed") {
        where.status = { in: COMPLETED_STATUSES };
      } else if (Object.values(SubmissionStatus).includes(status as SubmissionStatusType)) {
        where.status = status;
      }
    }

    // Exclude drafts from customer view
    if (!where.status) {
      where.status = { in: [...PENDING_STATUSES, ...COMPLETED_STATUSES, SubmissionStatus.CANCELLED, SubmissionStatus.RETURNED] };
    }

    // Debug: Log the exact where clause
    console.log('[my-submissions] Query where clause:', JSON.stringify(where));

    // Fetch submissions with pagination
    const [submissions, total, stats] = await Promise.all([
      prisma.tradeInSubmission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { items: true } },
        },
      }),

      prisma.tradeInSubmission.count({ where }),

      // Calculate stats for this customer (all submissions, not filtered)
      calculateCustomerStats(context.internalCustomerId),
    ]);

    // Debug: Also query without status filter to see if customer has any submissions at all
    const allSubmissionsCount = await prisma.tradeInSubmission.count({
      where: { customerId: context.internalCustomerId }
    });
    console.log('[my-submissions] Customer total submissions (no status filter):', allSubmissionsCount);

    // Debug: Check if customer exists in this database
    const customerCheck = await prisma.customer.findUnique({
      where: { id: context.internalCustomerId }
    });
    console.log('[my-submissions] Customer exists in DB:', !!customerCheck);

    // Debug: Count all submissions in database
    const totalSubmissionsInDb = await prisma.tradeInSubmission.count();
    console.log('[my-submissions] Total submissions in entire database:', totalSubmissionsInDb);

    // Debug: Check what tables exist by counting records
    const totalCustomers = await prisma.customer.count();
    const totalCards = await prisma.cardPriceV2.count();
    console.log('[my-submissions] Total customers:', totalCustomers, 'Total cards:', totalCards);

    // Debug: Raw SQL to check tables in ALL schemas
    let tableCheck: any[] = [];
    let dbConnectionTest = "unknown";
    let currentSchema = "unknown";
    try {
      // Test basic connection
      const testResult = await prisma.$queryRaw`SELECT current_database() as db, current_schema() as schema, current_user as user`;
      const test = (testResult as any[])[0];
      dbConnectionTest = `db=${test.db}, schema=${test.schema}, user=${test.user}`;
      currentSchema = test.schema;

      tableCheck = await prisma.$queryRaw`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      ` as any[];
    } catch (err: any) {
      dbConnectionTest = `ERROR: ${err.message}`;
    }
    console.log('[my-submissions] All tables in database:', tableCheck, 'Connection:', dbConnectionTest);

    // Debug: Log query results
    console.log('[my-submissions] Query results:', {
      customerId: context.internalCustomerId,
      submissionsFound: submissions.length,
      total,
      stats,
    });

    // Format response
    const formattedSubmissions: SubmissionSummary[] = submissions.map((sub) => ({
      id: sub.id,
      submissionNumber: sub.submissionNumber,
      status: sub.status,
      statusLabel:
        SubmissionStatusLabels[sub.status as keyof typeof SubmissionStatusLabels] ||
        sub.status,
      itemCount: sub._count.items,
      quotedTotal: sub.quotedTotal,
      finalTotal: sub.finalTotal,
      payoutType: sub.payoutType,
      payoutTypeLabel: PAYOUT_TYPE_LABELS[sub.payoutType] || sub.payoutType,
      createdAt: sub.createdAt.toISOString(),
      submittedAt: sub.submittedAt?.toISOString() || null,
      completedAt: sub.completedAt?.toISOString() || null,
      // Quick action flags
      canDownloadPackingSlip:
        sub.status === SubmissionStatus.SUBMITTED ||
        sub.status === SubmissionStatus.IN_TRANSIT,
      canViewShippingInstructions:
        sub.status === SubmissionStatus.SUBMITTED ||
        sub.status === SubmissionStatus.IN_TRANSIT,
      needsReview: sub.status === SubmissionStatus.PENDING_APPROVAL,
      isComplete: sub.status === SubmissionStatus.COMPLETED,
    }));

    const totalPages = Math.ceil(total / limit);

    const response: CustomerSubmissionsResponse & { _debug?: any } = {
      submissions: formattedSubmissions,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
      // Debug info - REMOVE AFTER DEBUGGING
      _debug: {
        shopifyCustomerId: context.customerId,
        internalCustomerId: context.internalCustomerId,
        submissionsFound: submissions.length,
        total,
        allSubmissionsCount, // Without status filter
        customerExistsInDb: !!customerCheck,
        totalSubmissionsInDb,
        totalCustomers,
        totalCards,
        tablesInDb: tableCheck.map((t: any) => `${t.table_schema}.${t.table_name}`),
        dbConnectionTest,
        currentSchema,
        dbHost: process.env.DATABASE_URL?.match(/@([^:]+):/)?.[1] || "unknown",
        dbName: process.env.DATABASE_URL?.match(/\/([^?]+)(\?|$)/)?.[1] || "unknown",
        dbSchema: process.env.DATABASE_URL?.match(/schema=([^&]+)/)?.[1] || "public (default)",
        fullDbUrl: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@') || "not set", // Mask password
      },
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("Error fetching customer submissions:", error);
    return errorResponse(500, "fetch_failed", "Failed to load submissions");
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function calculateCustomerStats(customerId: string): Promise<CustomerStats> {
  const [total, pending, completed, earnings] = await Promise.all([
    // Total submissions (excluding drafts)
    prisma.tradeInSubmission.count({
      where: {
        customerId,
        status: { not: SubmissionStatus.DRAFT },
      },
    }),

    // Pending submissions
    prisma.tradeInSubmission.count({
      where: {
        customerId,
        status: { in: PENDING_STATUSES },
      },
    }),

    // Completed submissions
    prisma.tradeInSubmission.count({
      where: {
        customerId,
        status: SubmissionStatus.COMPLETED,
      },
    }),

    // Total earned from completed submissions
    prisma.tradeInSubmission.aggregate({
      where: {
        customerId,
        status: SubmissionStatus.COMPLETED,
      },
      _sum: {
        finalTotal: true,
        bonusAmount: true,
      },
    }),
  ]);

  const totalEarned =
    (earnings._sum.finalTotal || 0) + (earnings._sum.bonusAmount || 0);

  return {
    total,
    pending,
    completed,
    totalEarned,
  };
}

// Only GET is supported
export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
