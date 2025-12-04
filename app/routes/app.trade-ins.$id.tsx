import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  SubmissionStatus,
  SubmissionStatusLabels,
  type SubmissionStatusType,
  ItemStatus,
  Condition,
  ConditionLabels,
  type ConditionType,
  PayoutTypeLabels,
  type PayoutTypeValue,
  formatPrice,
  isConditionWorse,
} from "../lib/constants";

interface ItemData {
  id: string;
  cardName: string;
  setName: string;
  setCode: string | null;
  variant: string | null;
  quantity: number;
  conditionClaimed: string;
  conditionActual: string | null;
  quotedPrice: number;
  finalPrice: number | null;
  adjustmentReason: string | null;
  status: string;
  cardPrice: {
    priceNM: number;
    priceLP: number;
    priceMP: number;
    priceHP: number;
    priceDMG: number;
  } | null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Server-only imports
  const { getValidNextStatuses, attemptTransition } = await import("../lib/workflow.server");
  type SubmissionContext = Parameters<typeof attemptTransition>[0];
  await authenticate.admin(request);

  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      items: {
        include: {
          cardPrice: {
            select: {
              priceNM: true,
              priceLP: true,
              priceMP: true,
              priceHP: true,
              priceDMG: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      notes: {
        orderBy: { createdAt: "desc" },
      },
      payout: true,
    },
  });

  if (!submission) {
    throw new Response("Submission not found", { status: 404 });
  }

  // Get settings for this shop
  const settings = await prisma.tradeInSettings.findFirst();

  // Calculate grading progress
  const gradedItems = submission.items.filter(
    (item) => item.status !== ItemStatus.PENDING
  );
  const gradingProgress = {
    total: submission.items.length,
    graded: gradedItems.length,
    verified: submission.items.filter((i) => i.status === ItemStatus.VERIFIED).length,
    adjusted: submission.items.filter((i) => i.status === ItemStatus.ADJUSTED).length,
    rejected: submission.items.filter((i) => i.status === ItemStatus.REJECTED).length,
  };

  // Build context for workflow
  const context: SubmissionContext = {
    currentStatus: submission.status as SubmissionStatusType,
    itemsCount: submission.items.length,
    gradedItemsCount: gradedItems.length,
    totalValue: submission.finalTotal ?? submission.quotedTotal,
    requiresApproval: (submission.finalTotal ?? submission.quotedTotal) >= (settings?.requiresApprovalAbove ?? 5000),
    allItemsGraded: gradedItems.length === submission.items.length,
  };

  // Get valid next statuses and pre-compute transition results for client
  const validNextStatuses = getValidNextStatuses(submission.status as SubmissionStatusType);
  const transitionResults = validNextStatuses.reduce((acc, status) => {
    const result = attemptTransition(context, status);
    acc[status] = { allowed: result.allowed, reason: result.reason };
    return acc;
  }, {} as Record<string, { allowed: boolean; reason?: string }>);

  return {
    submission: {
      ...submission,
      createdAt: submission.createdAt.toISOString(),
      updatedAt: submission.updatedAt.toISOString(),
      submittedAt: submission.submittedAt?.toISOString() || null,
      receivedAt: submission.receivedAt?.toISOString() || null,
      gradedAt: submission.gradedAt?.toISOString() || null,
      approvedAt: submission.approvedAt?.toISOString() || null,
      completedAt: submission.completedAt?.toISOString() || null,
      notes: submission.notes.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
      })),
      payout: submission.payout
        ? {
            ...submission.payout,
            createdAt: submission.payout.createdAt.toISOString(),
            updatedAt: submission.payout.updatedAt.toISOString(),
            processedAt: submission.payout.processedAt?.toISOString() || null,
          }
        : null,
    },
    gradingProgress,
    validNextStatuses,
    transitionResults,
    settings: settings
      ? {
          conditionMultiplierNM: settings.conditionMultiplierNM,
          conditionMultiplierLP: settings.conditionMultiplierLP,
          conditionMultiplierMP: settings.conditionMultiplierMP,
          conditionMultiplierHP: settings.conditionMultiplierHP,
          conditionMultiplierDMG: settings.conditionMultiplierDMG,
        }
      : null,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  // Server-only imports
  const { attemptTransition } = await import("../lib/workflow.server");
  type SubmissionContext = Parameters<typeof attemptTransition>[0];

  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "updateStatus": {
      const newStatus = formData.get("status") as SubmissionStatusType;
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id: params.id },
        include: { items: true },
      });

      if (!submission) {
        return { error: "Submission not found" };
      }

      // Validate transition
      const gradedCount = submission.items.filter(
        (i) => i.status !== ItemStatus.PENDING
      ).length;

      const context: SubmissionContext = {
        currentStatus: submission.status as SubmissionStatusType,
        itemsCount: submission.items.length,
        gradedItemsCount: gradedCount,
        totalValue: submission.finalTotal ?? submission.quotedTotal,
        requiresApproval: false,
        allItemsGraded: gradedCount === submission.items.length,
      };

      const result = attemptTransition(context, newStatus);

      if (!result.allowed) {
        return { error: result.reason };
      }

      const now = new Date();
      const updateData: Record<string, unknown> = { status: newStatus };

      // Set appropriate timestamp
      if (newStatus === SubmissionStatus.SUBMITTED) updateData.submittedAt = now;
      if (newStatus === SubmissionStatus.RECEIVED) updateData.receivedAt = now;
      if (newStatus === SubmissionStatus.GRADING) {
        // If moving to grading, also set receivedAt if not set
        if (!submission.receivedAt) updateData.receivedAt = now;
      }
      if (
        newStatus === SubmissionStatus.PENDING_APPROVAL ||
        newStatus === SubmissionStatus.APPROVED
      ) {
        updateData.gradedAt = now;
      }
      if (newStatus === SubmissionStatus.APPROVED) updateData.approvedAt = now;
      if (newStatus === SubmissionStatus.COMPLETED) updateData.completedAt = now;

      await prisma.tradeInSubmission.update({
        where: { id: params.id },
        data: updateData,
      });

      await prisma.submissionNote.create({
        data: {
          submissionId: params.id!,
          authorType: "SYSTEM",
          message: `Status changed to ${SubmissionStatusLabels[newStatus]}`,
          isInternal: true,
        },
      });

      return { success: true, action: "statusUpdated" };
    }

    case "gradeItem": {
      const itemId = formData.get("itemId") as string;
      const conditionActual = formData.get("conditionActual") as ConditionType;
      const adjustmentReason = (formData.get("adjustmentReason") as string) || null;
      const action = formData.get("action") as "verify" | "adjust" | "reject";

      const item = await prisma.tradeInItem.findUnique({
        where: { id: itemId },
        include: { cardPrice: true, submission: true },
      });

      if (!item) {
        return { error: "Item not found" };
      }

      let finalPrice = item.quotedPrice;
      let status: string = ItemStatus.VERIFIED;

      if (action === "reject") {
        finalPrice = 0;
        status = ItemStatus.REJECTED;
      } else if (action === "adjust" || isConditionWorse(conditionActual, item.conditionClaimed as ConditionType)) {
        // Calculate new price based on actual condition
        if (item.cardPrice) {
          const priceKey = `price${conditionActual}` as keyof typeof item.cardPrice;
          finalPrice = (item.cardPrice[priceKey] as number) * item.quantity;
        }
        status = ItemStatus.ADJUSTED;
      }

      await prisma.tradeInItem.update({
        where: { id: itemId },
        data: {
          conditionActual,
          finalPrice,
          adjustmentReason,
          status,
        },
      });

      // Recalculate submission total
      const allItems = await prisma.tradeInItem.findMany({
        where: { submissionId: item.submissionId },
      });

      const finalTotal = allItems.reduce(
        (sum, i) => sum + (i.finalPrice ?? i.quotedPrice),
        0
      );

      await prisma.tradeInSubmission.update({
        where: { id: item.submissionId },
        data: { finalTotal },
      });

      return { success: true, action: "itemGraded" };
    }

    case "bulkGrade": {
      const gradeAction = formData.get("gradeAction") as "verify-all" | "use-claimed";
      const submissionId = params.id!;

      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id: submissionId },
        include: { items: { include: { cardPrice: true } } },
      });

      if (!submission) {
        return { error: "Submission not found" };
      }

      const pendingItems = submission.items.filter(
        (i) => i.status === ItemStatus.PENDING
      );

      for (const item of pendingItems) {
        const conditionActual = item.conditionClaimed;
        let finalPrice = item.quotedPrice;

        if (gradeAction === "use-claimed" && item.cardPrice) {
          const priceKey = `price${conditionActual}` as keyof typeof item.cardPrice;
          finalPrice = (item.cardPrice[priceKey] as number) * item.quantity;
        }

        await prisma.tradeInItem.update({
          where: { id: item.id },
          data: {
            conditionActual,
            finalPrice,
            status: ItemStatus.VERIFIED,
          },
        });
      }

      // Recalculate submission total
      const allItems = await prisma.tradeInItem.findMany({
        where: { submissionId },
      });

      const finalTotal = allItems.reduce(
        (sum, i) => sum + (i.finalPrice ?? i.quotedPrice),
        0
      );

      await prisma.tradeInSubmission.update({
        where: { id: submissionId },
        data: { finalTotal },
      });

      await prisma.submissionNote.create({
        data: {
          submissionId,
          authorType: "SYSTEM",
          message: `Bulk graded ${pendingItems.length} items as verified`,
          isInternal: true,
        },
      });

      return { success: true, action: "bulkGraded", count: pendingItems.length };
    }

    case "addNote": {
      const message = formData.get("message") as string;
      const isInternal = formData.get("isInternal") === "true";

      if (!message?.trim()) {
        return { error: "Message is required" };
      }

      await prisma.submissionNote.create({
        data: {
          submissionId: params.id!,
          authorType: "MERCHANT",
          message: message.trim(),
          isInternal,
        },
      });

      return { success: true, action: "noteAdded" };
    }

    default:
      return { error: "Unknown action" };
  }
};

export default function TradeInDetail() {
  const { submission, gradingProgress, validNextStatuses, transitionResults, settings } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data) {
      if ("success" in fetcher.data && fetcher.data.success) {
        const messages: Record<string, string> = {
          statusUpdated: "Status updated successfully",
          itemGraded: "Item graded",
          bulkGraded: `Graded ${(fetcher.data as { count?: number }).count || "all pending"} items`,
          noteAdded: "Note added",
        };
        shopify.toast.show(messages[(fetcher.data as { action: string }).action] || "Updated");
      } else if ("error" in fetcher.data) {
        shopify.toast.show((fetcher.data as { error: string }).error, { isError: true });
      }
    }
  }, [fetcher.data, shopify]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isGradingMode =
    submission.status === SubmissionStatus.RECEIVED ||
    submission.status === SubmissionStatus.GRADING;

  const statusColors: Record<string, { bg: string; text: string }> = {
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

  const itemStatusColors: Record<string, { bg: string; text: string }> = {
    PENDING: { bg: "#f3f4f6", text: "#6b7280" },
    VERIFIED: { bg: "#d1fae5", text: "#059669" },
    ADJUSTED: { bg: "#fef3c7", text: "#b45309" },
    REJECTED: { bg: "#fee2e2", text: "#dc2626" },
  };

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        maxWidth: "1200px",
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <Link
            to="/app/trade-ins"
            style={{ color: "#6b7280", textDecoration: "none", fontSize: "14px" }}
          >
            ← Back to Submissions
          </Link>
          <h1 style={{ margin: "8px 0 0", fontSize: "24px", fontWeight: 600 }}>
            Trade-In #{submission.submissionNumber}
          </h1>
          <div style={{ display: "flex", gap: "12px", marginTop: "8px", alignItems: "center" }}>
            <span
              style={{
                background: statusColors[submission.status]?.bg || "#f3f4f6",
                color: statusColors[submission.status]?.text || "#6b7280",
                padding: "4px 12px",
                borderRadius: "4px",
                fontSize: "13px",
                fontWeight: 500,
              }}
            >
              {SubmissionStatusLabels[submission.status as keyof typeof SubmissionStatusLabels] ||
                submission.status}
            </span>
            <span style={{ color: "#6b7280", fontSize: "14px" }}>
              Created {formatDate(submission.createdAt)}
            </span>
          </div>
        </div>

        {/* Status Actions */}
        {validNextStatuses.length > 0 && (
          <div style={{ display: "flex", gap: "8px" }}>
            {validNextStatuses.map((status) => {
              const isPrimary =
                status === SubmissionStatus.APPROVED ||
                status === SubmissionStatus.COMPLETED;
              const isDestructive =
                status === SubmissionStatus.CANCELLED ||
                status === SubmissionStatus.RETURNED;

              // Check if transition is allowed (pre-computed on server)
              const transitionResult = transitionResults[status];
              const isDisabled = !transitionResult?.allowed;

              return (
                <fetcher.Form method="post" key={status}>
                  <input type="hidden" name="intent" value="updateStatus" />
                  <input type="hidden" name="status" value={status} />
                  <button
                    type="submit"
                    disabled={isLoading || isDisabled}
                    title={isDisabled ? transitionResult.reason : undefined}
                    style={{
                      padding: "10px 20px",
                      borderRadius: "6px",
                      border: isPrimary ? "none" : "1px solid #e5e7eb",
                      background: isPrimary
                        ? "#000"
                        : isDestructive
                          ? "#fee2e2"
                          : "#fff",
                      color: isPrimary ? "#fff" : isDestructive ? "#dc2626" : "#111827",
                      cursor: isDisabled ? "not-allowed" : "pointer",
                      fontSize: "14px",
                      fontWeight: 500,
                      opacity: isDisabled ? 0.5 : 1,
                    }}
                  >
                    {SubmissionStatusLabels[status as keyof typeof SubmissionStatusLabels]}
                  </button>
                </fetcher.Form>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px" }}>
        {/* Main Content */}
        <div>
          {/* Summary Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "16px",
              marginBottom: "24px",
            }}
          >
            <SummaryCard
              label="Quoted Total"
              value={formatPrice(submission.quotedTotal)}
            />
            <SummaryCard
              label="Final Total"
              value={formatPrice(submission.finalTotal ?? submission.quotedTotal)}
              highlight={
                submission.finalTotal !== null &&
                submission.finalTotal !== submission.quotedTotal
              }
            />
            <SummaryCard label="Items" value={String(submission.items.length)} />
            <SummaryCard
              label="Payout Method"
              value={
                PayoutTypeLabels[submission.payoutType as PayoutTypeValue] ||
                submission.payoutType
              }
            />
          </div>

          {/* Grading Progress (if in grading mode) */}
          {isGradingMode && (
            <div
              style={{
                background: "#fff",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                padding: "20px",
                marginBottom: "24px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
                  Grading Progress
                </h3>
                {gradingProgress.total - gradingProgress.graded > 0 && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="bulkGrade" />
                    <input type="hidden" name="gradeAction" value="verify-all" />
                    <button
                      type="submit"
                      disabled={isLoading}
                      style={{
                        padding: "8px 16px",
                        background: "#f3f4f6",
                        border: "1px solid #e5e7eb",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      Verify All Remaining
                    </button>
                  </fetcher.Form>
                )}
              </div>

              {/* Progress Bar */}
              <div
                style={{
                  height: "8px",
                  background: "#f3f4f6",
                  borderRadius: "4px",
                  overflow: "hidden",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(gradingProgress.graded / gradingProgress.total) * 100}%`,
                    background: "#10b981",
                    transition: "width 0.3s",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "24px", fontSize: "14px" }}>
                <span style={{ color: "#6b7280" }}>
                  <strong>{gradingProgress.graded}</strong> / {gradingProgress.total} graded
                </span>
                <span style={{ color: "#059669" }}>
                  {gradingProgress.verified} verified
                </span>
                <span style={{ color: "#b45309" }}>
                  {gradingProgress.adjusted} adjusted
                </span>
                <span style={{ color: "#dc2626" }}>
                  {gradingProgress.rejected} rejected
                </span>
              </div>
            </div>
          )}

          {/* Items List */}
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
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
                Items ({submission.items.length})
              </h3>
            </div>

            {submission.items.map((item: ItemData) => (
              <div
                key={item.id}
                style={{
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                {/* Item Row */}
                <div
                  style={{
                    padding: "16px 20px",
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 100px 80px",
                    alignItems: "center",
                    cursor: isGradingMode ? "pointer" : "default",
                    background: expandedItem === item.id ? "#f9fafb" : "transparent",
                  }}
                  onClick={() =>
                    isGradingMode &&
                    setExpandedItem(expandedItem === item.id ? null : item.id)
                  }
                >
                  {/* Card Info */}
                  <div>
                    <div style={{ fontWeight: 500 }}>{item.cardName}</div>
                    <div style={{ color: "#6b7280", fontSize: "13px" }}>
                      {item.setName}
                      {item.variant && ` • ${item.variant}`}
                      {item.quantity > 1 && ` • Qty: ${item.quantity}`}
                    </div>
                  </div>

                  {/* Condition */}
                  <div>
                    <div style={{ fontSize: "13px" }}>
                      Claimed:{" "}
                      <strong>
                        {ConditionLabels[item.conditionClaimed as ConditionType]}
                      </strong>
                    </div>
                    {item.conditionActual && (
                      <div
                        style={{
                          fontSize: "13px",
                          color:
                            item.conditionActual !== item.conditionClaimed
                              ? "#b45309"
                              : "#059669",
                        }}
                      >
                        Actual:{" "}
                        <strong>
                          {ConditionLabels[item.conditionActual as ConditionType]}
                        </strong>
                      </div>
                    )}
                  </div>

                  {/* Price */}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600 }}>
                      {formatPrice(item.finalPrice ?? item.quotedPrice)}
                    </div>
                    {item.finalPrice !== null &&
                      item.finalPrice !== item.quotedPrice && (
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#9ca3af",
                            textDecoration: "line-through",
                          }}
                        >
                          {formatPrice(item.quotedPrice)}
                        </div>
                      )}
                  </div>

                  {/* Status */}
                  <div>
                    <span
                      style={{
                        background:
                          itemStatusColors[item.status]?.bg || "#f3f4f6",
                        color: itemStatusColors[item.status]?.text || "#6b7280",
                        padding: "3px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 500,
                      }}
                    >
                      {item.status}
                    </span>
                  </div>

                  {/* Expand */}
                  {isGradingMode && (
                    <div style={{ textAlign: "right", color: "#6b7280" }}>
                      {expandedItem === item.id ? "▲" : "▼"}
                    </div>
                  )}
                </div>

                {/* Expanded Grading Form */}
                {isGradingMode && expandedItem === item.id && (
                  <div
                    style={{
                      padding: "16px 20px",
                      background: "#f9fafb",
                      borderTop: "1px solid #e5e7eb",
                    }}
                  >
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="gradeItem" />
                      <input type="hidden" name="itemId" value={item.id} />

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 2fr auto",
                          gap: "16px",
                          alignItems: "end",
                        }}
                      >
                        <div>
                          <label
                            style={{
                              display: "block",
                              fontSize: "13px",
                              fontWeight: 500,
                              marginBottom: "6px",
                            }}
                          >
                            Actual Condition
                          </label>
                          <select
                            name="conditionActual"
                            defaultValue={
                              item.conditionActual || item.conditionClaimed
                            }
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              border: "1px solid #e5e7eb",
                              borderRadius: "6px",
                              fontSize: "14px",
                            }}
                          >
                            {Object.entries(ConditionLabels).map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label
                            style={{
                              display: "block",
                              fontSize: "13px",
                              fontWeight: 500,
                              marginBottom: "6px",
                            }}
                          >
                            Adjustment Reason (optional)
                          </label>
                          <input
                            type="text"
                            name="adjustmentReason"
                            defaultValue={item.adjustmentReason || ""}
                            placeholder="e.g., Light scratching on back"
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              border: "1px solid #e5e7eb",
                              borderRadius: "6px",
                              fontSize: "14px",
                            }}
                          />
                        </div>

                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="submit"
                            name="action"
                            value="verify"
                            disabled={isLoading}
                            style={{
                              padding: "8px 16px",
                              background: "#10b981",
                              color: "#fff",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "14px",
                              fontWeight: 500,
                            }}
                          >
                            Verify
                          </button>
                          <button
                            type="submit"
                            name="action"
                            value="adjust"
                            disabled={isLoading}
                            style={{
                              padding: "8px 16px",
                              background: "#f59e0b",
                              color: "#fff",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "14px",
                              fontWeight: 500,
                            }}
                          >
                            Adjust
                          </button>
                          <button
                            type="submit"
                            name="action"
                            value="reject"
                            disabled={isLoading}
                            style={{
                              padding: "8px 16px",
                              background: "#ef4444",
                              color: "#fff",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "14px",
                              fontWeight: 500,
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>

                      {/* Price Preview */}
                      {item.cardPrice && (
                        <div
                          style={{
                            marginTop: "16px",
                            padding: "12px",
                            background: "#fff",
                            borderRadius: "6px",
                            border: "1px solid #e5e7eb",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "13px",
                              color: "#6b7280",
                              marginBottom: "8px",
                            }}
                          >
                            Price by condition:
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: "16px",
                              fontSize: "13px",
                            }}
                          >
                            <span>
                              NM: {formatPrice(item.cardPrice.priceNM * item.quantity)}
                            </span>
                            <span>
                              LP: {formatPrice(item.cardPrice.priceLP * item.quantity)}
                            </span>
                            <span>
                              MP: {formatPrice(item.cardPrice.priceMP * item.quantity)}
                            </span>
                            <span>
                              HP: {formatPrice(item.cardPrice.priceHP * item.quantity)}
                            </span>
                            <span>
                              DMG: {formatPrice(item.cardPrice.priceDMG * item.quantity)}
                            </span>
                          </div>
                        </div>
                      )}
                    </fetcher.Form>

                    {item.adjustmentReason && (
                      <div
                        style={{
                          marginTop: "12px",
                          padding: "12px",
                          background: "#fef3c7",
                          borderRadius: "6px",
                          fontSize: "14px",
                          color: "#92400e",
                        }}
                      >
                        <strong>Adjustment Note:</strong> {item.adjustmentReason}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div>
          {/* Customer Card */}
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              padding: "20px",
              marginBottom: "16px",
            }}
          >
            <h3
              style={{
                margin: "0 0 16px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#6b7280",
                textTransform: "uppercase",
              }}
            >
              Customer
            </h3>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>
              {submission.customer.firstName} {submission.customer.lastName}
            </div>
            <a
              href={`mailto:${submission.customer.email}`}
              style={{ color: "#3b82f6", fontSize: "14px" }}
            >
              {submission.customer.email}
            </a>
            {submission.customer.phone && (
              <div style={{ color: "#6b7280", fontSize: "14px", marginTop: "4px" }}>
                {submission.customer.phone}
              </div>
            )}
          </div>

          {/* Timeline Card */}
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              padding: "20px",
              marginBottom: "16px",
            }}
          >
            <h3
              style={{
                margin: "0 0 16px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#6b7280",
                textTransform: "uppercase",
              }}
            >
              Timeline
            </h3>
            <div style={{ fontSize: "14px" }}>
              {[
                { label: "Created", date: submission.createdAt },
                { label: "Submitted", date: submission.submittedAt },
                { label: "Received", date: submission.receivedAt },
                { label: "Graded", date: submission.gradedAt },
                { label: "Approved", date: submission.approvedAt },
                { label: "Completed", date: submission.completedAt },
              ]
                .filter((t) => t.date)
                .map((t) => (
                  <div
                    key={t.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "8px",
                    }}
                  >
                    <span style={{ color: "#6b7280" }}>{t.label}</span>
                    <span>{formatDate(t.date!)}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Notes Card */}
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              padding: "20px",
            }}
          >
            <h3
              style={{
                margin: "0 0 16px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#6b7280",
                textTransform: "uppercase",
              }}
            >
              Notes
            </h3>

            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="addNote" />
              <textarea
                name="message"
                placeholder="Add a note..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  fontSize: "14px",
                  resize: "vertical",
                  marginBottom: "8px",
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <label style={{ fontSize: "13px", color: "#6b7280" }}>
                  <input type="checkbox" name="isInternal" value="true" /> Internal
                  only
                </label>
                <button
                  type="submit"
                  disabled={isLoading}
                  style={{
                    padding: "6px 12px",
                    background: "#f3f4f6",
                    border: "1px solid #e5e7eb",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  Add Note
                </button>
              </div>
            </fetcher.Form>

            {submission.notes.length > 0 && (
              <div style={{ marginTop: "16px", borderTop: "1px solid #e5e7eb", paddingTop: "16px" }}>
                {submission.notes.map((note) => (
                  <div
                    key={note.id}
                    style={{
                      padding: "12px",
                      background: note.isInternal ? "#fef3c7" : "#f9fafb",
                      borderRadius: "6px",
                      marginBottom: "8px",
                      fontSize: "14px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "4px",
                        fontSize: "12px",
                        color: "#6b7280",
                      }}
                    >
                      <span>
                        {note.authorType}
                        {note.isInternal && " (Internal)"}
                      </span>
                      <span>{formatDate(note.createdAt)}</span>
                    </div>
                    <div>{note.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "8px",
        border: "1px solid #e5e7eb",
        padding: "16px",
      }}
    >
      <div style={{ color: "#6b7280", fontSize: "13px", marginBottom: "4px" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: "20px",
          fontWeight: 600,
          color: highlight ? "#b45309" : "#111827",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
