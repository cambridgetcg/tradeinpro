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
import "../styles/admin-trade-ins.css";

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
  marketPricePence: number | null; // Base market price for condition calculations
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

  console.log('[app.trade-ins.$id] Loading submission:', params.id);

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
    console.log('[app.trade-ins.$id] Submission not found:', params.id);
    throw new Response("Submission not found", { status: 404 });
  }

  console.log('[app.trade-ins.$id] Found submission:', submission.submissionNumber, 'status:', submission.status);

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

  console.log('[app.trade-ins.$id] Returning data for submission:', submission.submissionNumber, 'items:', submission.items.length);

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
  const { createPayout } = await import("../lib/payouts.server");
  const {
    sendSubmissionReceivedNotification,
    sendGradingCompleteNotification,
  } = await import("../lib/notifications.server");
  type SubmissionContext = Parameters<typeof attemptTransition>[0];

  const { session } = await authenticate.admin(request);

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

      // Auto-create payout when transitioning to APPROVED
      if (newStatus === SubmissionStatus.APPROVED) {
        const payoutResult = await createPayout(session.shop, params.id!);
        if (!payoutResult.success) {
          console.error("Failed to create payout:", payoutResult.error);
          // Don't fail the status update, just log the error
          // Payout can be created manually from the payouts page
        }
      }

      // Send email notifications for key status changes
      // Fetch fresh submission data for notifications
      const updatedSubmission = await prisma.tradeInSubmission.findUnique({
        where: { id: params.id },
        include: { customer: true, items: true },
      });

      if (updatedSubmission) {
        try {
          if (newStatus === SubmissionStatus.RECEIVED) {
            await sendSubmissionReceivedNotification(updatedSubmission);
          } else if (newStatus === SubmissionStatus.PENDING_APPROVAL) {
            await sendGradingCompleteNotification(updatedSubmission);
          }
          // Note: APPROVED notification is sent via payout processing
          // Note: SUBMITTED notification is sent when customer submits from storefront
        } catch (notifyError) {
          console.error("Failed to send notification:", notifyError);
          // Don't fail the status update
        }
      }

      return { success: true, action: "statusUpdated" };
    }

    case "gradeItem": {
      const itemId = formData.get("itemId") as string;
      const conditionActual = formData.get("conditionActual") as ConditionType;
      const adjustmentReason = (formData.get("adjustmentReason") as string) || null;
      const action = formData.get("action") as "verify" | "adjust" | "reject";

      // Get settings for price calculation
      const settings = await prisma.tradeInSettings.findFirst();
      const multipliers: Record<string, number> = {
        NM: settings?.conditionMultiplierNM ?? 0.70,
        LP: settings?.conditionMultiplierLP ?? 0.55,
        MP: settings?.conditionMultiplierMP ?? 0.40,
        HP: settings?.conditionMultiplierHP ?? 0.25,
        DMG: settings?.conditionMultiplierDMG ?? 0.10,
      };

      const item = await prisma.tradeInItem.findUnique({
        where: { id: itemId },
        include: { submission: true },
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
        // Calculate new price based on actual condition using marketPricePence
        if (item.marketPricePence) {
          const multiplier = multipliers[conditionActual] ?? 0.70;
          // Round down to nearest 10p, same as initial calculation
          const pricePerUnit = Math.floor(item.marketPricePence * multiplier / 10) * 10;
          finalPrice = pricePerUnit * item.quantity;
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
        include: { items: true },
      });

      if (!submission) {
        return { error: "Submission not found" };
      }

      const pendingItems = submission.items.filter(
        (i) => i.status === ItemStatus.PENDING
      );

      // For bulk verify, we use the quoted price (already calculated at submission)
      // The condition is verified as matching the claimed condition
      for (const item of pendingItems) {
        await prisma.tradeInItem.update({
          where: { id: item.id },
          data: {
            conditionActual: item.conditionClaimed,
            finalPrice: item.quotedPrice, // Keep original quoted price
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

    case "updateTracking": {
      const trackingNumber = (formData.get("trackingNumber") as string)?.trim() || null;

      await prisma.tradeInSubmission.update({
        where: { id: params.id },
        data: { trackingNumber },
      });

      // Add a note about the tracking update
      if (trackingNumber) {
        await prisma.submissionNote.create({
          data: {
            submissionId: params.id!,
            authorType: "SYSTEM",
            message: `Tracking number updated: ${trackingNumber}`,
            isInternal: true,
          },
        });
      }

      return { success: true, action: "trackingUpdated" };
    }

    default:
      return { error: "Unknown action" };
  }
};

export default function TradeInDetail() {
  console.log('[TradeInDetail] Component rendering');

  const loaderData = useLoaderData<typeof loader>();
  console.log('[TradeInDetail] Loader data:', loaderData ? 'present' : 'missing');

  const { submission, gradingProgress, validNextStatuses, transitionResults, settings } = loaderData;
  console.log('[TradeInDetail] Submission:', submission?.submissionNumber);

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
          trackingUpdated: "Tracking number updated",
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

  return (
    <div className="admin-trade-ins">
      {/* Header */}
      <div className="admin-trade-ins__header">
        <div>
          <Link to="/app/trade-ins" className="admin-trade-ins__back-link">
            ← Back to Submissions
          </Link>
          <h1 className="admin-trade-ins__title">
            Trade-In #{submission.submissionNumber}
          </h1>
          <div className="admin-header-meta">
            <span className={`admin-badge admin-badge--${submission.status.toLowerCase()}`}>
              {SubmissionStatusLabels[submission.status as keyof typeof SubmissionStatusLabels] ||
                submission.status}
            </span>
            <span className="admin-header-meta__date">
              Created {formatDate(submission.createdAt)}
            </span>
          </div>
        </div>

        {/* Status Actions */}
        {validNextStatuses.length > 0 && (
          <div className="admin-actions">
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

              let btnClass = "admin-btn";
              if (isPrimary) btnClass += " admin-btn--primary";
              else if (isDestructive) btnClass += " admin-btn--danger";
              else btnClass += " admin-btn--secondary";

              return (
                <fetcher.Form method="post" key={status}>
                  <input type="hidden" name="intent" value="updateStatus" />
                  <input type="hidden" name="status" value={status} />
                  <button
                    type="submit"
                    disabled={isLoading || isDisabled}
                    title={isDisabled ? transitionResult.reason : undefined}
                    className={btnClass}
                  >
                    {SubmissionStatusLabels[status as keyof typeof SubmissionStatusLabels]}
                  </button>
                </fetcher.Form>
              );
            })}
          </div>
        )}
      </div>

      <div className="admin-detail">
        {/* Main Content */}
        <div className="admin-detail__main">
          {/* Summary Cards */}
          <div className="admin-summary-grid">
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
            <div className="admin-progress">
              <div className="admin-progress__header">
                <h3 className="admin-progress__title">Grading Progress</h3>
                {gradingProgress.total - gradingProgress.graded > 0 && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="bulkGrade" />
                    <input type="hidden" name="gradeAction" value="verify-all" />
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="admin-btn admin-btn--secondary admin-btn--sm"
                    >
                      Verify All Remaining
                    </button>
                  </fetcher.Form>
                )}
              </div>

              {/* Progress Bar */}
              <div className="admin-progress__bar">
                <div
                  className="admin-progress__fill"
                  style={{ width: `${(gradingProgress.graded / gradingProgress.total) * 100}%` }}
                />
              </div>

              <div className="admin-progress__stats">
                <span className="admin-progress__stat">
                  <strong>{gradingProgress.graded}</strong> / {gradingProgress.total} graded
                </span>
                <span className="admin-progress__stat admin-progress__stat--verified">
                  {gradingProgress.verified} verified
                </span>
                <span className="admin-progress__stat admin-progress__stat--adjusted">
                  {gradingProgress.adjusted} adjusted
                </span>
                <span className="admin-progress__stat admin-progress__stat--rejected">
                  {gradingProgress.rejected} rejected
                </span>
              </div>
            </div>
          )}

          {/* Items List */}
          <div className="admin-items">
            <div className="admin-card__header">
              <h3 className="admin-card__title">Items ({submission.items.length})</h3>
            </div>

            {submission.items.map((item: ItemData) => (
              <div key={item.id} className="admin-item">
                {/* Item Row */}
                <div
                  className={`admin-item__row ${expandedItem === item.id ? 'admin-item__row--expanded' : ''}`}
                  onClick={() =>
                    isGradingMode &&
                    setExpandedItem(expandedItem === item.id ? null : item.id)
                  }
                  style={{ cursor: isGradingMode ? 'pointer' : 'default' }}
                >
                  {/* Card Info */}
                  <div className="admin-item__info">
                    <div className="admin-item__name">{item.cardName}</div>
                    <div className="admin-item__meta">
                      {item.setName}
                      {item.variant && ` • ${item.variant}`}
                      {item.quantity > 1 && ` • Qty: ${item.quantity}`}
                    </div>
                  </div>

                  {/* Condition */}
                  <div className="admin-item__condition">
                    <div className="admin-item__condition-claimed">
                      Claimed: <strong>{ConditionLabels[item.conditionClaimed as ConditionType]}</strong>
                    </div>
                    {item.conditionActual && (
                      <div className={`admin-item__condition-actual ${
                        item.conditionActual !== item.conditionClaimed
                          ? 'admin-item__condition-actual--diff'
                          : 'admin-item__condition-actual--same'
                      }`}>
                        Actual: <strong>{ConditionLabels[item.conditionActual as ConditionType]}</strong>
                      </div>
                    )}
                  </div>

                  {/* Price */}
                  <div className="admin-item__price">
                    <div className="admin-item__price-current">
                      {formatPrice(item.finalPrice ?? item.quotedPrice)}
                    </div>
                    {item.finalPrice !== null &&
                      item.finalPrice !== item.quotedPrice && (
                        <div className="admin-item__price-original">
                          {formatPrice(item.quotedPrice)}
                        </div>
                      )}
                  </div>

                  {/* Status */}
                  <div>
                    <span className={`admin-badge admin-badge--${item.status.toLowerCase()}`}>
                      {item.status}
                    </span>
                  </div>

                  {/* Expand */}
                  {isGradingMode && (
                    <div className="admin-item__expand">
                      {expandedItem === item.id ? "▲" : "▼"}
                    </div>
                  )}
                </div>

                {/* Expanded Grading Form */}
                {isGradingMode && expandedItem === item.id && (
                  <div className="admin-item__panel">
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="gradeItem" />
                      <input type="hidden" name="itemId" value={item.id} />

                      <div className="admin-item__form">
                        <div className="admin-field">
                          <label className="admin-field__label">
                            Actual Condition
                          </label>
                          <select
                            name="conditionActual"
                            defaultValue={item.conditionActual || item.conditionClaimed}
                            className="admin-field__select"
                          >
                            {Object.entries(ConditionLabels).map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="admin-field">
                          <label className="admin-field__label">
                            Adjustment Reason (optional)
                          </label>
                          <input
                            type="text"
                            name="adjustmentReason"
                            defaultValue={item.adjustmentReason || ""}
                            placeholder="e.g., Light scratching on back"
                            className="admin-field__input"
                          />
                        </div>

                        <div className="admin-item__actions">
                          <button
                            type="submit"
                            name="action"
                            value="verify"
                            disabled={isLoading}
                            className="admin-btn admin-btn--success admin-btn--sm"
                          >
                            Verify
                          </button>
                          <button
                            type="submit"
                            name="action"
                            value="adjust"
                            disabled={isLoading}
                            className="admin-btn admin-btn--warning admin-btn--sm"
                          >
                            Adjust
                          </button>
                          <button
                            type="submit"
                            name="action"
                            value="reject"
                            disabled={isLoading}
                            className="admin-btn admin-btn--danger admin-btn--sm"
                          >
                            Reject
                          </button>
                        </div>
                      </div>

                      {/* Price Preview - using marketPricePence with settings multipliers */}
                      {item.marketPricePence && settings && (
                        <div className="admin-price-preview">
                          <div className="admin-price-preview__title">
                            Price by condition (market: {formatPrice(item.marketPricePence)}):
                          </div>
                          <div className="admin-price-preview__list">
                            <span>
                              NM: {formatPrice(Math.floor(item.marketPricePence * settings.conditionMultiplierNM / 10) * 10 * item.quantity)}
                            </span>
                            <span>
                              LP: {formatPrice(Math.floor(item.marketPricePence * settings.conditionMultiplierLP / 10) * 10 * item.quantity)}
                            </span>
                            <span>
                              MP: {formatPrice(Math.floor(item.marketPricePence * settings.conditionMultiplierMP / 10) * 10 * item.quantity)}
                            </span>
                            <span>
                              HP: {formatPrice(Math.floor(item.marketPricePence * settings.conditionMultiplierHP / 10) * 10 * item.quantity)}
                            </span>
                            <span>
                              DMG: {formatPrice(Math.floor(item.marketPricePence * settings.conditionMultiplierDMG / 10) * 10 * item.quantity)}
                            </span>
                          </div>
                        </div>
                      )}
                    </fetcher.Form>

                    {item.adjustmentReason && (
                      <div className="admin-adjustment-note">
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
        <div className="admin-detail__sidebar">
          {/* Customer Card */}
          <div className="admin-sidebar-card">
            <h3 className="admin-sidebar-card__title">Customer</h3>
            <div className="admin-customer">
              <div className="admin-customer__name">
                {submission.customer.firstName} {submission.customer.lastName}
              </div>
              <a href={`mailto:${submission.customer.email}`} className="admin-customer__email">
                {submission.customer.email}
              </a>
              {submission.customer.phone && (
                <div className="admin-customer__phone">
                  {submission.customer.phone}
                </div>
              )}
            </div>
          </div>

          {/* Shipping Card - show for SUBMITTED, IN_TRANSIT, or RECEIVED statuses */}
          {(submission.status === SubmissionStatus.SUBMITTED ||
            submission.status === SubmissionStatus.IN_TRANSIT ||
            submission.status === SubmissionStatus.RECEIVED) && (
            <div className="admin-sidebar-card">
              <h3 className="admin-sidebar-card__title">Shipping</h3>
              <fetcher.Form method="post" className="admin-shipping__form">
                <input type="hidden" name="intent" value="updateTracking" />
                <div className="admin-field">
                  <label className="admin-field__label">Tracking Number</label>
                  <input
                    type="text"
                    name="trackingNumber"
                    defaultValue={submission.trackingNumber || ""}
                    placeholder="Enter tracking number"
                    className="admin-field__input"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="admin-btn admin-btn--secondary"
                >
                  Save Tracking
                </button>
              </fetcher.Form>
              {submission.trackingNumber && (
                <div className="admin-shipping__link">
                  <a
                    href={`https://www.royalmail.com/track-your-item#/tracking-results/${submission.trackingNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Track on Royal Mail →
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Timeline Card */}
          <div className="admin-sidebar-card">
            <h3 className="admin-sidebar-card__title">Timeline</h3>
            <div className="admin-timeline">
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
                  <div key={t.label} className="admin-timeline__item">
                    <span className="admin-timeline__label">{t.label}</span>
                    <span className="admin-timeline__date">{formatDate(t.date!)}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Notes Card */}
          <div className="admin-sidebar-card">
            <h3 className="admin-sidebar-card__title">Notes</h3>

            <fetcher.Form method="post" className="admin-notes__form">
              <input type="hidden" name="intent" value="addNote" />
              <textarea
                name="message"
                placeholder="Add a note..."
                rows={3}
                className="admin-notes__textarea"
              />
              <div className="admin-notes__footer">
                <label className="admin-notes__checkbox">
                  <input type="checkbox" name="isInternal" value="true" />
                  Internal only
                </label>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="admin-btn admin-btn--secondary admin-btn--sm"
                >
                  Add Note
                </button>
              </div>
            </fetcher.Form>

            {submission.notes.length > 0 && (
              <div className="admin-notes__list">
                {submission.notes.map((note) => (
                  <div
                    key={note.id}
                    className={`admin-note ${note.isInternal ? 'admin-note--internal' : 'admin-note--external'}`}
                  >
                    <div className="admin-note__header">
                      <span>
                        {note.authorType}
                        {note.isInternal && " (Internal)"}
                      </span>
                      <span>{formatDate(note.createdAt)}</span>
                    </div>
                    <div className="admin-note__message">{note.message}</div>
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
    <div className="admin-summary-card">
      <div className="admin-summary-card__label">{label}</div>
      <div className={`admin-summary-card__value ${highlight ? 'admin-summary-card__value--highlight' : ''}`}>
        {value}
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return (
    <div className="admin-trade-ins admin-error">
      <h1 className="admin-error__title">Error Loading Submission</h1>
      <p className="admin-error__message">Something went wrong while loading this trade-in submission.</p>
      <a href="/app/trade-ins" className="admin-error__link">
        ← Back to Submissions
      </a>
    </div>
  );
}
