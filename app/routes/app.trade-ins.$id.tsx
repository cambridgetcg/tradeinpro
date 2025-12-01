import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
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

const conditionLabels: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const submission = await db.tradeInSubmission.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      items: {
        include: {
          cardPrice: true,
        },
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

  return { submission };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "updateStatus": {
      const newStatus = formData.get("status") as string;
      const now = new Date();

      const updateData: Record<string, unknown> = { status: newStatus };

      if (newStatus === "RECEIVED") updateData.receivedAt = now;
      if (newStatus === "APPROVED") updateData.approvedAt = now;
      if (newStatus === "COMPLETED") updateData.completedAt = now;

      await db.tradeInSubmission.update({
        where: { id: params.id },
        data: updateData,
      });

      await db.submissionNote.create({
        data: {
          submissionId: params.id!,
          authorType: "SYSTEM",
          message: `Status changed to ${newStatus}`,
        },
      });

      return { success: true, action: "statusUpdated" };
    }

    case "addNote": {
      const message = formData.get("message") as string;
      const isInternal = formData.get("isInternal") === "true";

      await db.submissionNote.create({
        data: {
          submissionId: params.id!,
          authorType: "MERCHANT",
          message,
          isInternal,
        },
      });

      return { success: true, action: "noteAdded" };
    }

    case "updateItemCondition": {
      const itemId = formData.get("itemId") as string;
      const conditionActual = formData.get("conditionActual") as string;
      const adjustmentReason = formData.get("adjustmentReason") as string;

      const item = await db.tradeInItem.findUnique({
        where: { id: itemId },
        include: { cardPrice: true },
      });

      if (!item || !item.cardPrice) {
        return { error: "Item not found" };
      }

      const priceKey = `price${conditionActual}` as keyof typeof item.cardPrice;
      const newPrice = (item.cardPrice[priceKey] as number) * item.quantity;

      await db.tradeInItem.update({
        where: { id: itemId },
        data: {
          conditionActual,
          finalPrice: newPrice,
          adjustmentReason: adjustmentReason || null,
          status: newPrice !== item.quotedPrice ? "ADJUSTED" : "VERIFIED",
        },
      });

      const items = await db.tradeInItem.findMany({
        where: { submissionId: params.id },
      });

      const finalTotal = items.reduce(
        (sum, i) => sum + (i.finalPrice ?? i.quotedPrice),
        0
      );

      await db.tradeInSubmission.update({
        where: { id: params.id },
        data: { finalTotal },
      });

      return { success: true, action: "itemUpdated" };
    }

    default:
      return { error: "Unknown action" };
  }
};

export default function TradeInDetail() {
  const { submission } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(
        fetcher.data.action === "statusUpdated"
          ? "Status updated"
          : fetcher.data.action === "noteAdded"
            ? "Note added"
            : "Item updated"
      );
    }
  }, [fetcher.data, shopify]);

  const formatPrice = (cents: number | null) => {
    if (cents === null) return "-";
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getNextStatuses = (currentStatus: string) => {
    const transitions: Record<string, string[]> = {
      SUBMITTED: ["IN_TRANSIT", "RECEIVED", "CANCELLED"],
      IN_TRANSIT: ["RECEIVED", "RETURNED"],
      RECEIVED: ["GRADING"],
      GRADING: ["PENDING_APPROVAL", "APPROVED"],
      PENDING_APPROVAL: ["APPROVED", "RETURNED"],
      APPROVED: ["COMPLETED"],
    };
    return transitions[currentStatus] || [];
  };

  const nextStatuses = getNextStatuses(submission.status);

  return (
    <s-page heading={`Trade-In #${submission.submissionNumber}`}>
      <Link to="/app/trade-ins" slot="back-action">
        <s-button variant="tertiary">Back to Trade-Ins</s-button>
      </Link>

      {/* Status actions */}
      {nextStatuses.length > 0 && (
        <s-stack slot="primary-action" direction="inline" gap="tight">
          {nextStatuses.map((status) => (
            <fetcher.Form method="post" key={status}>
              <input type="hidden" name="intent" value="updateStatus" />
              <input type="hidden" name="status" value={status} />
              <s-button
                variant={status === "APPROVED" || status === "COMPLETED" ? "primary" : "secondary"}
                loading={isLoading}
              >
                {status.replace(/_/g, " ")}
              </s-button>
            </fetcher.Form>
          ))}
        </s-stack>
      )}

      {/* Overview section */}
      <s-section heading="Overview">
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="tight">
            <s-text tone="subdued">Status</s-text>
            <s-badge tone={statusColors[submission.status]}>
              {submission.status.replace(/_/g, " ")}
            </s-badge>
          </s-stack>
          <s-stack direction="block" gap="tight">
            <s-text tone="subdued">Payout Method</s-text>
            <s-text>
              <strong>{submission.payoutType.replace(/_/g, " ")}</strong>
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="tight">
            <s-text tone="subdued">Quoted Total</s-text>
            <s-text>
              <strong>{formatPrice(submission.quotedTotal)}</strong>
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="tight">
            <s-text tone="subdued">Final Total</s-text>
            <s-text>
              <strong>{formatPrice(submission.finalTotal)}</strong>
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {/* Customer section */}
      <s-section heading="Customer">
        <s-stack direction="block" gap="tight">
          <s-text>
            <strong>
              {submission.customer.firstName} {submission.customer.lastName}
            </strong>
          </s-text>
          <s-link href={`mailto:${submission.customer.email}`}>
            {submission.customer.email}
          </s-link>
          {submission.customer.phone && (
            <s-text>{submission.customer.phone}</s-text>
          )}
        </s-stack>
      </s-section>

      {/* Items section */}
      <s-section heading={`Items (${submission.items.length})`}>
        {submission.items.map((item) => (
          <s-box key={item.id} padding="base" borderBlockEndWidth="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="large">
                <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                  <s-text>
                    <strong>{item.cardName}</strong>
                  </s-text>
                  <s-text tone="subdued">
                    {item.setName}
                    {item.variant && ` - ${item.variant}`}
                  </s-text>
                  <s-text tone="subdued">Qty: {item.quantity}</s-text>
                </s-stack>
                <s-stack direction="block" gap="tight">
                  <s-text>Claimed: {conditionLabels[item.conditionClaimed]}</s-text>
                  {item.conditionActual && (
                    <s-text>Actual: {conditionLabels[item.conditionActual]}</s-text>
                  )}
                  <s-stack direction="inline" gap="tight">
                    <s-text tone="subdued">Quoted: {formatPrice(item.quotedPrice)}</s-text>
                    {item.finalPrice !== null && (
                      <s-text>
                        <strong>Final: {formatPrice(item.finalPrice)}</strong>
                      </s-text>
                    )}
                  </s-stack>
                </s-stack>
              </s-stack>

              {/* Grading controls */}
              {(submission.status === "GRADING" || submission.status === "RECEIVED") && (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="updateItemCondition" />
                  <input type="hidden" name="itemId" value={item.id} />
                  <s-stack direction="inline" gap="base">
                    <s-select
                      label="Actual Condition"
                      name="conditionActual"
                      defaultValue={item.conditionActual || item.conditionClaimed}
                    >
                      <option value="NM">Near Mint</option>
                      <option value="LP">Lightly Played</option>
                      <option value="MP">Moderately Played</option>
                      <option value="HP">Heavily Played</option>
                      <option value="DMG">Damaged</option>
                    </s-select>
                    <s-text-field
                      label="Adjustment Reason"
                      name="adjustmentReason"
                      defaultValue={item.adjustmentReason || ""}
                    />
                    <s-button type="submit" loading={isLoading}>
                      Update
                    </s-button>
                  </s-stack>
                </fetcher.Form>
              )}

              {item.adjustmentReason && (
                <s-banner tone="warning">
                  <s-text>{item.adjustmentReason}</s-text>
                </s-banner>
              )}
            </s-stack>
          </s-box>
        ))}
      </s-section>

      {/* Shipping section */}
      <s-section heading="Shipping">
        <s-stack direction="block" gap="tight">
          <s-text>Method: {submission.shippingMethod || "Not set"}</s-text>
          {submission.trackingNumber && (
            <s-text>Tracking: {submission.trackingNumber}</s-text>
          )}
        </s-stack>
      </s-section>

      {/* Timeline section */}
      <s-section heading="Timeline">
        <s-stack direction="block" gap="tight">
          <s-text>Created: {formatDate(submission.createdAt)}</s-text>
          {submission.submittedAt && (
            <s-text>Submitted: {formatDate(submission.submittedAt)}</s-text>
          )}
          {submission.receivedAt && (
            <s-text>Received: {formatDate(submission.receivedAt)}</s-text>
          )}
          {submission.gradedAt && (
            <s-text>Graded: {formatDate(submission.gradedAt)}</s-text>
          )}
          {submission.approvedAt && (
            <s-text>Approved: {formatDate(submission.approvedAt)}</s-text>
          )}
          {submission.completedAt && (
            <s-text>Completed: {formatDate(submission.completedAt)}</s-text>
          )}
        </s-stack>
      </s-section>

      {/* Payout section */}
      {submission.payout && (
        <s-section heading="Payout">
          <s-stack direction="block" gap="tight">
            <s-text>Type: {submission.payout.type}</s-text>
            <s-text>Amount: {formatPrice(submission.payout.amount)}</s-text>
            {submission.payout.bonusAmount > 0 && (
              <s-text>Bonus: {formatPrice(submission.payout.bonusAmount)}</s-text>
            )}
            <s-text>
              <strong>Total: {formatPrice(submission.payout.totalAmount)}</strong>
            </s-text>
            <s-badge
              tone={
                submission.payout.status === "COMPLETED"
                  ? "success"
                  : submission.payout.status === "FAILED"
                    ? "critical"
                    : "info"
              }
            >
              {submission.payout.status}
            </s-badge>
          </s-stack>
        </s-section>
      )}

      {/* Notes section */}
      <s-section heading="Notes">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="addNote" />
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Add a note"
              name="message"
              multiline={3}
            />
            <s-stack direction="inline" gap="tight">
              <s-checkbox name="isInternal" value="true">
                Internal only (not visible to customer)
              </s-checkbox>
              <s-button type="submit" loading={isLoading}>
                Add Note
              </s-button>
            </s-stack>
          </s-stack>
        </fetcher.Form>

        {submission.notes.length > 0 && (
          <s-box paddingBlockStart="large">
            <s-stack direction="block" gap="base">
              {submission.notes.map((note) => (
                <s-box
                  key={note.id}
                  padding="base"
                  background={note.isInternal ? "subdued" : undefined}
                  borderRadius="base"
                  borderWidth="base"
                >
                  <s-stack direction="block" gap="tight">
                    <s-stack direction="inline" gap="tight">
                      <s-badge
                        tone={
                          note.authorType === "SYSTEM"
                            ? "info"
                            : note.authorType === "MERCHANT"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {note.authorType}
                      </s-badge>
                      {note.isInternal && (
                        <s-badge tone="neutral">Internal</s-badge>
                      )}
                      <s-text tone="subdued">{formatDate(note.createdAt)}</s-text>
                    </s-stack>
                    <s-text>{note.message}</s-text>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
