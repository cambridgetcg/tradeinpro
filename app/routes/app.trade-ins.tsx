import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  const submissions = await db.tradeInSubmission.findMany({
    where: status ? { status } : undefined,
    include: {
      customer: true,
      items: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const counts = await db.tradeInSubmission.groupBy({
    by: ["status"],
    _count: { status: true },
  });

  const countMap = counts.reduce(
    (acc, curr) => {
      acc[curr.status] = curr._count.status;
      return acc;
    },
    {} as Record<string, number>
  );

  return { submissions, countMap, currentStatus: status };
};

export default function TradeIns() {
  const { submissions, countMap, currentStatus } =
    useLoaderData<typeof loader>();

  const totalCount = Object.values(countMap).reduce((a, b) => a + b, 0);

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <s-page heading="Trade-Ins">
      <Link to="/app/trade-ins/new" style={{ textDecoration: "none" }}>
        <s-button slot="primary-action">Create Submission</s-button>
      </Link>

      {/* Status filter tabs */}
      <s-box paddingBlockEnd="large">
        <s-stack direction="inline" gap="tight">
          <Link to="/app/trade-ins" style={{ textDecoration: "none" }}>
            <s-badge tone={!currentStatus ? "info" : "neutral"}>
              All ({totalCount})
            </s-badge>
          </Link>
          <Link to="/app/trade-ins?status=SUBMITTED" style={{ textDecoration: "none" }}>
            <s-badge tone={currentStatus === "SUBMITTED" ? "info" : "neutral"}>
              Submitted ({countMap.SUBMITTED || 0})
            </s-badge>
          </Link>
          <Link to="/app/trade-ins?status=RECEIVED" style={{ textDecoration: "none" }}>
            <s-badge tone={currentStatus === "RECEIVED" ? "warning" : "neutral"}>
              Received ({countMap.RECEIVED || 0})
            </s-badge>
          </Link>
          <Link to="/app/trade-ins?status=GRADING" style={{ textDecoration: "none" }}>
            <s-badge tone={currentStatus === "GRADING" ? "warning" : "neutral"}>
              Grading ({countMap.GRADING || 0})
            </s-badge>
          </Link>
          <Link to="/app/trade-ins?status=PENDING_APPROVAL" style={{ textDecoration: "none" }}>
            <s-badge tone={currentStatus === "PENDING_APPROVAL" ? "warning" : "neutral"}>
              Pending ({countMap.PENDING_APPROVAL || 0})
            </s-badge>
          </Link>
          <Link to="/app/trade-ins?status=COMPLETED" style={{ textDecoration: "none" }}>
            <s-badge tone={currentStatus === "COMPLETED" ? "success" : "neutral"}>
              Completed ({countMap.COMPLETED || 0})
            </s-badge>
          </Link>
        </s-stack>
      </s-box>

      {/* Submissions list */}
      {submissions.length === 0 ? (
        <s-section>
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>No trade-in submissions yet</strong>
              </s-text>
              <s-paragraph>
                Trade-in submissions from customers will appear here.
              </s-paragraph>
              <Link to="/app/trade-ins/new" style={{ textDecoration: "none" }}>
                <s-button>Create Test Submission</s-button>
              </Link>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        <s-section>
          {submissions.map((submission) => (
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
                      {submission.customer.firstName} {submission.customer.lastName} •{" "}
                      {submission.customer.email}
                    </s-text>
                    <s-text tone="subdued">
                      {submission.items.length} items • {formatDate(submission.createdAt)}
                    </s-text>
                  </s-stack>
                  <s-stack direction="block" gap="tight">
                    <s-text>
                      <strong>{formatPrice(submission.quotedTotal)}</strong>
                    </s-text>
                    <s-text tone="subdued">{submission.payoutType.replace(/_/g, " ")}</s-text>
                  </s-stack>
                </s-stack>
              </s-box>
            </Link>
          ))}
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
