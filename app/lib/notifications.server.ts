/**
 * Email notification service
 * Handles sending emails for submission lifecycle events
 *
 * MVP: Logs emails to console
 * Production: Integrate with SendGrid/Postmark/Mailgun
 */

import prisma from "../db.server";
import { formatPrice } from "./constants";

// ============================================================================
// Types
// ============================================================================

export enum NotificationType {
  SUBMISSION_CREATED = "submission_created",
  SUBMISSION_RECEIVED = "submission_received",
  GRADING_COMPLETE = "grading_complete",
  GRADING_APPROVED = "grading_approved",
  PAYOUT_ISSUED = "payout_issued",
  RETURN_REQUESTED = "return_requested",
  RETURN_SHIPPED = "return_shipped",
  MERCHANT_NEW_SUBMISSION = "merchant_new_submission",
  MERCHANT_RETURN_REQUESTED = "merchant_return_requested",
}

export interface EmailContent {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SubmissionEmailContext {
  customerName: string;
  customerEmail: string;
  submissionNumber: string;
  quotedTotal: number;
  finalTotal?: number;
  bonusAmount?: number;
  itemCount: number;
  payoutType: string;
  hasAccount?: boolean; // Whether customer has a linked Shopify account
}

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = process.env.SHOPIFY_APP_URL || "https://cardforum.vercel.app";
const SHOP_URL = process.env.SHOP_URL || "https://cardforum.co.uk";
const MERCHANT_EMAIL = process.env.MERCHANT_EMAIL || "trade-ins@cardforum.co.uk";
const FROM_EMAIL = process.env.FROM_EMAIL || "trade-in@cardforum.co.uk";

function buildTrackingUrl(submissionNumber: string): string {
  // Use the theme page, not the API endpoint (which returns JSON)
  return `${SHOP_URL}/pages/trade-in-track?number=${submissionNumber}`;
}

function buildAccountUrl(): string {
  return `${SHOP_URL}/account`;
}

function buildCreateAccountUrl(email: string): string {
  return `${SHOP_URL}/account/register?email=${encodeURIComponent(email)}`;
}

function buildAccountSection(ctx: { hasAccount?: boolean; customerEmail: string }): string {
  if (ctx.hasAccount) {
    return `
      <div style="background: #f0f8ff; border: 1px solid #0066cc; padding: 15px; margin: 20px 0; text-align: center; border-radius: 4px;">
        <p style="margin: 0 0 10px 0; font-weight: bold; color: #0066cc;">View All Your Trade-Ins</p>
        <p style="margin: 0; font-size: 14px; color: #666;">Sign in to your account to see your complete trade-in history.</p>
        <p style="margin: 10px 0 0 0;">
          <a href="${buildAccountUrl()}" style="color: #0066cc; text-decoration: underline;">Go to My Account</a>
        </p>
      </div>
    `;
  } else {
    return `
      <div style="background: #fff8e8; border: 1px solid #cc8800; padding: 15px; margin: 20px 0; text-align: center; border-radius: 4px;">
        <p style="margin: 0 0 10px 0; font-weight: bold; color: #996600;">Create an Account</p>
        <p style="margin: 0; font-size: 14px; color: #666;">Create an account to easily track all your trade-ins in one place.</p>
        <p style="margin: 10px 0 0 0;">
          <a href="${buildCreateAccountUrl(ctx.customerEmail)}" style="color: #996600; text-decoration: underline;">Create Account</a>
        </p>
      </div>
    `;
  }
}

// ============================================================================
// Email Templates
// ============================================================================

/**
 * Submission Created - Sent when customer submits trade-in
 */
export function buildSubmissionCreatedEmail(ctx: SubmissionEmailContext): EmailContent {
  const trackingUrl = buildTrackingUrl(ctx.submissionNumber);
  const payoutLabel = formatPayoutType(ctx.payoutType, ctx.bonusAmount);

  return {
    to: ctx.customerEmail,
    subject: `Trade-In ${ctx.submissionNumber} Submitted`,
    text: `
Hi ${ctx.customerName},

Thank you for your trade-in submission!

Submission: ${ctx.submissionNumber}
Items: ${ctx.itemCount}
Quoted Total: ${formatPrice(ctx.quotedTotal)}
Payout Method: ${payoutLabel}

Next Steps:
1. Print your shipping label or use our return address
2. Package your cards securely (use sleeves and top loaders)
3. Drop off at your nearest Post Office

Track your submission: ${trackingUrl}

Questions? Reply to this email.

Thanks for trading with us!
CardForum Team
    `.trim(),
    html: buildEmailHtml({
      title: "Trade-In Submitted",
      greeting: `Hi ${ctx.customerName},`,
      body: `
        <p>Thank you for your trade-in submission!</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Submission</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${ctx.submissionNumber}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Items</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${ctx.itemCount}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Quoted Total</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${formatPrice(ctx.quotedTotal)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Payout</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${payoutLabel}</td>
          </tr>
        </table>

        <h3>Next Steps</h3>
        <ol>
          <li>Print your shipping label or use our return address</li>
          <li>Package your cards securely (use sleeves and top loaders)</li>
          <li>Drop off at your nearest Post Office</li>
        </ol>

        ${buildAccountSection(ctx)}
      `,
      cta: { text: "Track Your Submission", url: trackingUrl },
    }),
  };
}

/**
 * Submission Received - Sent when package arrives
 */
export function buildSubmissionReceivedEmail(ctx: SubmissionEmailContext): EmailContent {
  const trackingUrl = buildTrackingUrl(ctx.submissionNumber);

  return {
    to: ctx.customerEmail,
    subject: `Trade-In ${ctx.submissionNumber} Received`,
    text: `
Hi ${ctx.customerName},

Great news! We've received your trade-in submission ${ctx.submissionNumber}.

Our team will now grade your cards. This usually takes 1-3 business days.

We'll email you as soon as grading is complete.

Track your submission: ${trackingUrl}
${ctx.hasAccount ? `View all your trade-ins: ${buildAccountUrl()}` : `Create an account to track all submissions: ${buildCreateAccountUrl(ctx.customerEmail)}`}

Thanks for trading with us!
CardForum Team
    `.trim(),
    html: buildEmailHtml({
      title: "Package Received!",
      greeting: `Hi ${ctx.customerName},`,
      body: `
        <p>Great news! We've received your trade-in submission.</p>

        <div style="background: #f0f8ff; border: 1px solid #0066cc; padding: 15px; margin: 20px 0; text-align: center;">
          <div style="font-size: 18px; font-weight: bold; color: #0066cc;">${ctx.submissionNumber}</div>
          <div style="color: #666;">Status: Received</div>
        </div>

        <p>Our team will now grade your cards. This usually takes <strong>1-3 business days</strong>.</p>
        <p>We'll email you as soon as grading is complete.</p>

        ${buildAccountSection(ctx)}
      `,
      cta: { text: "Track Your Submission", url: trackingUrl },
    }),
  };
}

/**
 * Grading Complete - Sent when all items have been graded
 */
export function buildGradingCompleteEmail(
  ctx: SubmissionEmailContext & {
    hasAdjustments: boolean;
    adjustedItems?: Array<{ name: string; originalCondition: string; newCondition: string }>;
  }
): EmailContent {
  const trackingUrl = buildTrackingUrl(ctx.submissionNumber);
  const priceDiff = (ctx.finalTotal || 0) - ctx.quotedTotal;

  const adjustmentsList = ctx.adjustedItems
    ?.map((item) => `- ${item.name}: ${item.originalCondition} → ${item.newCondition}`)
    .join("\n") || "";

  return {
    to: ctx.customerEmail,
    subject: `Trade-In ${ctx.submissionNumber} Grading Complete${ctx.hasAdjustments ? " - Review Required" : ""}`,
    text: `
Hi ${ctx.customerName},

We've finished grading your trade-in ${ctx.submissionNumber}.

Original Quote: ${formatPrice(ctx.quotedTotal)}
Final Value: ${formatPrice(ctx.finalTotal || 0)}
${priceDiff !== 0 ? `Difference: ${priceDiff > 0 ? "+" : ""}${formatPrice(priceDiff)}` : ""}

${ctx.hasAdjustments ? `
Some items were graded at different conditions:
${adjustmentsList}

Please review and approve your submission: ${trackingUrl}
You have 7 days to approve or request a return.
` : `
All items matched your claimed conditions!
Your payout is being processed.
`}

Thanks for trading with us!
CardForum Team
    `.trim(),
    html: buildEmailHtml({
      title: ctx.hasAdjustments ? "Review Your Grading Results" : "Grading Complete!",
      greeting: `Hi ${ctx.customerName},`,
      body: `
        <p>We've finished grading your trade-in.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Original Quote</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${formatPrice(ctx.quotedTotal)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Final Value</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; ${priceDiff < 0 ? "color: #cc0000;" : ""}">${formatPrice(ctx.finalTotal || 0)}</td>
          </tr>
          ${priceDiff !== 0 ? `
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Difference</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: ${priceDiff > 0 ? "#008800" : "#cc0000"};">${priceDiff > 0 ? "+" : ""}${formatPrice(priceDiff)}</td>
          </tr>
          ` : ""}
        </table>

        ${ctx.hasAdjustments ? `
          <h3 style="color: #cc6600;">Adjusted Items</h3>
          <ul>
            ${ctx.adjustedItems?.map((item) => `
              <li>${item.name}: <strike>${item.originalCondition}</strike> → <strong>${item.newCondition}</strong></li>
            `).join("") || ""}
          </ul>
          <p><strong>Please review and approve your submission to proceed with payout.</strong></p>
          <p style="color: #666;">You have 7 days to approve or request a return.</p>
        ` : `
          <div style="background: #f0fff0; border: 1px solid #008800; padding: 15px; margin: 20px 0; text-align: center;">
            <span style="color: #008800; font-weight: bold;">✓ All items matched your claimed conditions!</span>
          </div>
          <p>Your payout is being processed.</p>
        `}
      `,
      cta: ctx.hasAdjustments
        ? { text: "Review & Approve", url: trackingUrl }
        : { text: "View Submission", url: trackingUrl },
    }),
  };
}

/**
 * Payout Issued - Sent when payout is complete
 */
export function buildPayoutIssuedEmail(
  ctx: SubmissionEmailContext & {
    payoutAmount: number;
    giftCardCode?: string;
    bankReference?: string;
  }
): EmailContent {
  return {
    to: ctx.customerEmail,
    subject: `Trade-In ${ctx.submissionNumber} Payout Complete!`,
    text: `
Hi ${ctx.customerName},

Great news! Your payout has been issued.

Submission: ${ctx.submissionNumber}
Amount: ${formatPrice(ctx.payoutAmount)}
Method: ${formatPayoutType(ctx.payoutType)}
${ctx.giftCardCode ? `Gift Card Code: ${ctx.giftCardCode}` : ""}
${ctx.bankReference ? `Reference: ${ctx.bankReference}` : ""}

${ctx.giftCardCode ? "Use your gift card at checkout - it never expires!" : ""}
${ctx.bankReference ? "Your bank transfer should arrive within 2-3 business days." : ""}

Thanks for trading with us!
CardForum Team
    `.trim(),
    html: buildEmailHtml({
      title: "Payout Complete!",
      greeting: `Hi ${ctx.customerName},`,
      body: `
        <p>Great news! Your payout has been issued.</p>

        <div style="background: #f0fff0; border: 2px solid #008800; padding: 20px; margin: 20px 0; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #008800;">${formatPrice(ctx.payoutAmount)}</div>
          <div style="color: #666; margin-top: 5px;">${formatPayoutType(ctx.payoutType)}</div>
        </div>

        ${ctx.giftCardCode ? `
          <div style="background: #f8f8f8; border: 1px solid #ddd; padding: 15px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Gift Card Code:</strong></p>
            <code style="background: #fff; border: 1px solid #ccc; padding: 10px 20px; font-size: 20px; display: inline-block;">${ctx.giftCardCode}</code>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">Use at checkout - never expires!</p>
          </div>
        ` : ""}

        ${ctx.bankReference ? `
          <p><strong>Bank Reference:</strong> ${ctx.bankReference}</p>
          <p style="color: #666;">Your transfer should arrive within 2-3 business days.</p>
        ` : ""}

        ${buildAccountSection(ctx)}
      `,
      cta: { text: "Shop Now", url: SHOP_URL },
    }),
  };
}

/**
 * Return Requested - Sent when customer rejects grading
 */
export function buildReturnRequestedEmail(
  ctx: SubmissionEmailContext,
  reason: string
): EmailContent {
  const trackingUrl = buildTrackingUrl(ctx.submissionNumber);

  return {
    to: ctx.customerEmail,
    subject: `Trade-In ${ctx.submissionNumber} Return Requested`,
    text: `
Hi ${ctx.customerName},

We've received your request to return the cards from submission ${ctx.submissionNumber}.

Reason: ${reason}

We'll ship your cards back within 2-3 business days and send you tracking information.

If you have any questions, please reply to this email.

CardForum Team
    `.trim(),
    html: buildEmailHtml({
      title: "Return Requested",
      greeting: `Hi ${ctx.customerName},`,
      body: `
        <p>We've received your request to return the cards from submission <strong>${ctx.submissionNumber}</strong>.</p>

        <div style="background: #fff8e8; border: 1px solid #cc8800; padding: 15px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Reason:</strong> ${reason}</p>
        </div>

        <p>We'll ship your cards back within <strong>2-3 business days</strong> and send you tracking information.</p>
        <p>If you have any questions, please reply to this email.</p>
      `,
      cta: { text: "View Submission", url: trackingUrl },
    }),
  };
}

/**
 * Grading Accepted - Sent when customer accepts the grading offer
 */
export function buildGradingAcceptedEmail(ctx: SubmissionEmailContext): EmailContent {
  const trackingUrl = buildTrackingUrl(ctx.submissionNumber);
  const payoutLabel = ctx.payoutType === "STORE_CREDIT" ? "Store Credit (+10% bonus)" : "Bank Transfer";

  return {
    to: ctx.customerEmail,
    subject: `Trade-In ${ctx.submissionNumber} Accepted - Payment Processing`,
    text: `
Hi ${ctx.customerName},

Thank you for accepting the grading offer for submission ${ctx.submissionNumber}!

We're now processing your payment:
- Final Total: ${formatPrice(ctx.finalTotal ?? ctx.quotedTotal)}
- Payout Method: ${payoutLabel}

${ctx.payoutType === "STORE_CREDIT"
  ? "Your gift card will be emailed to you shortly."
  : "Your bank transfer will be processed within 2-3 business days."}

You can track the status of your submission here: ${trackingUrl}

Thank you for trading with us!

CardForum Team
    `.trim(),
    html: buildEmailHtml({
      title: "Payment Processing",
      greeting: `Hi ${ctx.customerName},`,
      body: `
        <p>Thank you for accepting the grading offer for submission <strong>${ctx.submissionNumber}</strong>!</p>

        <div style="background: #e8f5e9; border: 1px solid #4caf50; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0 0 10px 0;"><strong>We're now processing your payment:</strong></p>
          <p style="margin: 5px 0;"><strong>Final Total:</strong> ${formatPrice(ctx.finalTotal ?? ctx.quotedTotal)}</p>
          <p style="margin: 5px 0;"><strong>Payout Method:</strong> ${payoutLabel}</p>
        </div>

        ${ctx.payoutType === "STORE_CREDIT"
          ? "<p>Your gift card will be emailed to you shortly once processed.</p>"
          : "<p>Your bank transfer will be processed within <strong>2-3 business days</strong>.</p>"}

        <p>Thank you for trading with us!</p>
      `,
      cta: { text: "View Submission", url: trackingUrl },
    }),
  };
}

/**
 * Merchant notification - New submission
 */
export function buildMerchantNewSubmissionEmail(ctx: SubmissionEmailContext): EmailContent {
  const adminUrl = `${BASE_URL}/app/trade-ins`;

  return {
    to: MERCHANT_EMAIL,
    subject: `[CardForum] New Trade-In ${ctx.submissionNumber}`,
    text: `
New trade-in submission received.

Submission: ${ctx.submissionNumber}
Customer: ${ctx.customerName} (${ctx.customerEmail})
Items: ${ctx.itemCount}
Quoted Total: ${formatPrice(ctx.quotedTotal)}
Payout: ${formatPayoutType(ctx.payoutType)}

View in admin: ${adminUrl}
    `.trim(),
    html: buildEmailHtml({
      title: "New Trade-In Submission",
      greeting: "New submission received:",
      body: `
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Submission</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${ctx.submissionNumber}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Customer</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${ctx.customerName} (${ctx.customerEmail})</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Items</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${ctx.itemCount}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Quoted Total</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${formatPrice(ctx.quotedTotal)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Payout</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${formatPayoutType(ctx.payoutType)}</td>
          </tr>
        </table>
      `,
      cta: { text: "View in Admin", url: adminUrl },
    }),
  };
}

// ============================================================================
// HTML Template Helper
// ============================================================================

function buildEmailHtml(opts: {
  title: string;
  greeting: string;
  body: string;
  cta?: { text: string; url: string };
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
  <div style="background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background: #1a1a1a; color: #fff; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">CardForum</h1>
      <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.8;">Trading Card Trade-Ins</p>
    </div>

    <div style="padding: 30px;">
      <h2 style="color: #1a1a1a; border-bottom: 2px solid #1a1a1a; padding-bottom: 10px; margin-top: 0;">${opts.title}</h2>

      <p style="margin-top: 0;">${opts.greeting}</p>

      ${opts.body}

      ${opts.cta ? `
        <p style="text-align: center; margin: 30px 0;">
          <a href="${opts.cta.url}" style="display: inline-block; background: #1a1a1a; color: #fff; padding: 15px 30px; text-decoration: none; font-weight: bold; border-radius: 4px;">${opts.cta.text}</a>
        </p>
      ` : ""}
    </div>

    <div style="background: #f8f8f8; padding: 20px; text-align: center; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #666; margin: 0;">
        Questions? Reply to this email or contact support@cardforum.co.uk<br>
        CardForum Ltd, Cambridge, UK
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatPayoutType(payoutType: string, bonusAmount?: number): string {
  switch (payoutType) {
    case "STORE_CREDIT":
      return bonusAmount && bonusAmount > 0
        ? `Store Credit (+${formatPrice(bonusAmount)} bonus)`
        : "Store Credit";
    case "BANK":
      return "Bank Transfer";
    case "PAYPAL":
      return "PayPal";
    default:
      return payoutType;
  }
}

// ============================================================================
// Email Sending
// ============================================================================

/**
 * Send email using configured provider
 * MVP: Console logging
 * Production: Integrate with SendGrid/Postmark/Mailgun
 */
export async function sendEmail(email: EmailContent): Promise<{ success: boolean; error?: string }> {
  // Log in development
  if (process.env.NODE_ENV !== "production") {
    console.log("📧 Email would be sent:");
    console.log(`   To: ${email.to}`);
    console.log(`   Subject: ${email.subject}`);
    console.log(`   Preview: ${email.text.slice(0, 100)}...`);
    return { success: true };
  }

  // Production: Integrate with email provider
  // Example with SendGrid:
  /*
  try {
    const sgMail = require("@sendgrid/mail");
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    await sgMail.send({
      to: email.to,
      from: FROM_EMAIL,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    return { success: true };
  } catch (error) {
    console.error("SendGrid error:", error);
    return { success: false, error: error.message };
  }
  */

  // For now, just log that we would send
  console.log(`📧 [PROD] Would send email to ${email.to}: ${email.subject}`);
  return { success: true };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Build submission context from database record
 */
export async function buildSubmissionContext(
  submission: any
): Promise<SubmissionEmailContext> {
  let customer = submission.customer;
  if (!customer) {
    customer = await prisma.customer.findUnique({
      where: { id: submission.customerId },
    });
  }

  const itemCount =
    submission.items?.length ||
    (await prisma.tradeInItem.count({
      where: { submissionId: submission.id },
    }));

  return {
    customerName:
      [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
      "Customer",
    customerEmail: customer?.email || "",
    submissionNumber: submission.submissionNumber,
    quotedTotal: submission.quotedTotal,
    finalTotal: submission.finalTotal || undefined,
    bonusAmount: submission.bonusAmount || undefined,
    itemCount,
    payoutType: submission.payoutType,
    hasAccount: !!customer?.shopifyCustomerId, // Has account if linked to Shopify
  };
}

/**
 * Send submission created notification
 */
export async function sendSubmissionCreatedNotification(
  submission: any
): Promise<void> {
  const ctx = await buildSubmissionContext(submission);

  // Send to customer
  const customerEmail = buildSubmissionCreatedEmail(ctx);
  await sendEmail(customerEmail);

  // Send to merchant
  const merchantEmail = buildMerchantNewSubmissionEmail(ctx);
  await sendEmail(merchantEmail);
}

/**
 * Send submission received notification
 */
export async function sendSubmissionReceivedNotification(
  submission: any
): Promise<void> {
  const ctx = await buildSubmissionContext(submission);
  const email = buildSubmissionReceivedEmail(ctx);
  await sendEmail(email);
}

/**
 * Send grading complete notification
 */
export async function sendGradingCompleteNotification(
  submission: any
): Promise<void> {
  const ctx = await buildSubmissionContext(submission);

  // Get adjusted items
  const items = await prisma.tradeInItem.findMany({
    where: { submissionId: submission.id },
  });

  const adjustedItems = items
    .filter(
      (item) =>
        item.conditionActual && item.conditionActual !== item.conditionClaimed
    )
    .map((item) => ({
      name: item.cardName,
      originalCondition: item.conditionClaimed,
      newCondition: item.conditionActual!,
    }));

  const email = buildGradingCompleteEmail({
    ...ctx,
    hasAdjustments: adjustedItems.length > 0,
    adjustedItems,
  });

  await sendEmail(email);
}

/**
 * Send payout issued notification
 */
export async function sendPayoutIssuedNotification(
  submission: any,
  payout: { totalAmount: number; giftCardCode?: string; bankReference?: string }
): Promise<void> {
  const ctx = await buildSubmissionContext(submission);

  const email = buildPayoutIssuedEmail({
    ...ctx,
    payoutAmount: payout.totalAmount,
    giftCardCode: payout.giftCardCode,
    bankReference: payout.bankReference,
  });

  await sendEmail(email);
}

/**
 * Send return requested notification
 */
export async function sendReturnRequestedNotification(
  submission: any,
  reason: string
): Promise<void> {
  const ctx = await buildSubmissionContext(submission);
  const email = buildReturnRequestedEmail(ctx, reason);
  await sendEmail(email);
}

/**
 * Send grading accepted notification (customer accepted the offer)
 */
export async function sendGradingAcceptedNotification(
  submission: any
): Promise<void> {
  const ctx = await buildSubmissionContext(submission);
  const email = buildGradingAcceptedEmail(ctx);
  await sendEmail(email);
}

/**
 * Check if notifications are enabled for a type
 */
export async function shouldSendNotification(
  type: NotificationType
): Promise<boolean> {
  const settings = await prisma.tradeInSettings.findFirst();

  switch (type) {
    case NotificationType.SUBMISSION_CREATED:
    case NotificationType.MERCHANT_NEW_SUBMISSION:
      return settings?.notifyOnSubmission ?? true;
    case NotificationType.SUBMISSION_RECEIVED:
      return settings?.notifyOnReceived ?? true;
    case NotificationType.GRADING_COMPLETE:
    case NotificationType.GRADING_APPROVED:
      return settings?.notifyOnGraded ?? true;
    default:
      return true;
  }
}
