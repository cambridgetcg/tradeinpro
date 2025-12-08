/**
 * Public Packing Slip API
 *
 * GET /apps/trade-in/packing-slip/:number
 *
 * Public endpoint for customers to view/print their packing slip.
 * Uses submission number for easier access (no login required).
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import prisma from "../db.server";
import { formatPrice } from "../lib/constants";
import { getShippingSettings, formatAddress } from "../lib/shipping.server";

// ============================================================================
// Loader
// ============================================================================

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { number } = params;

  if (!number) {
    return errorResponse(400, "missing_number", "Submission number is required");
  }

  // Validate App Proxy (but don't require customer login)
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const submissionNumber = sanitizeString(number, 50).toUpperCase();

  try {
    const submission = await prisma.tradeInSubmission.findUnique({
      where: { submissionNumber },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        items: {
          orderBy: { cardName: "asc" },
          select: {
            cardName: true,
            setName: true,
            setCode: true,
            variant: true,
            conditionClaimed: true,
            quantity: true,
            quotedPrice: true,
          },
        },
      },
    });

    if (!submission) {
      return new Response(
        generateErrorHTML("Submission Not Found", "Please check your reference number and try again."),
        {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }
      );
    }

    // Get return address from settings
    const settings = await getShippingSettings();
    const addressLines = formatAddress(settings.returnAddress);

    // Generate printable HTML
    const html = generatePackingSlipHTML(submission, addressLines);

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="packing-slip-${submissionNumber}.html"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Packing slip error:", error);
    return errorResponse(500, "generation_failed", "Failed to generate packing slip");
  }
}

// ============================================================================
// HTML Generation
// ============================================================================

interface SubmissionData {
  submissionNumber: string;
  createdAt: Date;
  quotedTotal: number;
  payoutType: string;
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
  items: {
    cardName: string;
    setName: string | null;
    setCode: string | null;
    variant: string | null;
    conditionClaimed: string;
    quantity: number;
    quotedPrice: number;
  }[];
}

function generatePackingSlipHTML(submission: SubmissionData, returnAddress: string[]): string {
  const itemRows = submission.items
    .map(
      (item, index) => `
    <tr>
      <td class="item-check"><input type="checkbox" aria-label="Check item ${index + 1}"></td>
      <td class="item-name">${escapeHtml(item.cardName)}</td>
      <td class="item-set">${escapeHtml(item.setCode || item.setName || "")}${item.variant ? ` - ${escapeHtml(item.variant)}` : ""}</td>
      <td class="item-condition">${item.conditionClaimed}</td>
      <td class="item-qty">${item.quantity}</td>
      <td class="item-price">${formatPrice(item.quotedPrice * item.quantity)}</td>
    </tr>
  `
    )
    .join("");

  const totalItems = submission.items.reduce((sum, i) => sum + i.quantity, 0);
  const bonusText = submission.payoutType === "STORE_CREDIT" ? " (+10% bonus)" : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Packing Slip - ${submission.submissionNumber}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 24px;
      max-width: 800px;
      margin: 0 auto;
      color: #111;
      font-size: 14px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #000;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .logo {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .logo-sub {
      font-size: 12px;
      color: #666;
      font-weight: 400;
    }
    .reference {
      text-align: right;
    }
    .reference-number {
      font-size: 20px;
      font-weight: 700;
      font-family: 'Courier New', monospace;
      background: #f3f4f6;
      padding: 8px 16px;
      border-radius: 4px;
      display: inline-block;
    }
    .reference-date {
      margin-top: 8px;
      color: #666;
      font-size: 13px;
    }
    .info-row {
      display: flex;
      gap: 24px;
      margin-bottom: 24px;
    }
    .info-box {
      flex: 1;
      padding: 16px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .info-box h3 {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #666;
      margin-bottom: 8px;
    }
    .info-box p {
      margin: 4px 0;
    }
    .address-lines {
      font-weight: 500;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    .items-table th {
      text-align: left;
      padding: 12px 8px;
      background: #111;
      color: #fff;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .items-table th:first-child {
      border-radius: 4px 0 0 0;
      width: 40px;
    }
    .items-table th:last-child {
      border-radius: 0 4px 0 0;
      text-align: right;
    }
    .items-table td {
      padding: 12px 8px;
      border-bottom: 1px solid #e5e7eb;
    }
    .items-table tr:nth-child(even) {
      background: #f9fafb;
    }
    .item-check {
      text-align: center;
    }
    .item-check input {
      width: 16px;
      height: 16px;
    }
    .item-name {
      font-weight: 500;
    }
    .item-set {
      color: #666;
      font-size: 13px;
    }
    .item-condition {
      font-weight: 600;
      text-align: center;
    }
    .item-qty {
      text-align: center;
    }
    .item-price {
      text-align: right;
      font-weight: 500;
    }
    .summary {
      display: flex;
      justify-content: space-between;
      gap: 24px;
    }
    .summary-totals {
      text-align: right;
    }
    .summary-totals table {
      margin-left: auto;
    }
    .summary-totals td {
      padding: 4px 0;
    }
    .summary-totals td:first-child {
      padding-right: 24px;
      color: #666;
    }
    .summary-totals .grand-total {
      font-size: 18px;
      font-weight: 700;
      border-top: 2px solid #111;
      padding-top: 8px;
    }
    .important-notice {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 16px;
      margin-top: 24px;
    }
    .important-notice h4 {
      color: #92400e;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .important-notice p {
      color: #78350f;
      font-size: 13px;
    }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
    .barcode {
      margin-top: 24px;
      text-align: center;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      letter-spacing: 4px;
    }
    @media print {
      body {
        padding: 0;
      }
      .no-print {
        display: none;
      }
    }
    .print-btn {
      position: fixed;
      top: 16px;
      right: 16px;
      background: #111;
      color: #fff;
      padding: 12px 24px;
      border: none;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
    }
    .print-btn:hover {
      background: #333;
    }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print Packing Slip</button>

  <div class="header">
    <div>
      <div class="logo">CardForum</div>
      <div class="logo-sub">Trade-In Packing Slip</div>
    </div>
    <div class="reference">
      <div class="reference-number">${submission.submissionNumber}</div>
      <div class="reference-date">${new Date(submission.createdAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}</div>
    </div>
  </div>

  <div class="info-row">
    <div class="info-box">
      <h3>Ship To</h3>
      <div class="address-lines">
        ${returnAddress.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      </div>
    </div>
    <div class="info-box">
      <h3>Customer</h3>
      <p><strong>${escapeHtml(submission.customer?.firstName || "")} ${escapeHtml(submission.customer?.lastName || "")}</strong></p>
      <p>${escapeHtml(submission.customer?.email || "")}</p>
      <p style="margin-top: 8px; color: #666;">Payout: ${submission.payoutType === "STORE_CREDIT" ? "Store Credit" : "Bank Transfer"}${bonusText}</p>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th></th>
        <th>Card Name</th>
        <th>Set / Variant</th>
        <th>Condition</th>
        <th>Qty</th>
        <th>Value</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="summary">
    <div>
      <strong>Total Cards:</strong> ${totalItems}
    </div>
    <div class="summary-totals">
      <table>
        <tr>
          <td>Quoted Total:</td>
          <td><strong>${formatPrice(submission.quotedTotal)}</strong></td>
        </tr>
        ${
          submission.payoutType === "STORE_CREDIT"
            ? `<tr>
                <td>+ 10% Bonus:</td>
                <td>${formatPrice(Math.round(submission.quotedTotal * 0.1))}</td>
              </tr>
              <tr class="grand-total">
                <td>Estimated Payout:</td>
                <td>${formatPrice(Math.round(submission.quotedTotal * 1.1))}</td>
              </tr>`
            : `<tr class="grand-total">
                <td>Estimated Payout:</td>
                <td>${formatPrice(submission.quotedTotal)}</td>
              </tr>`
        }
      </table>
    </div>
  </div>

  <div class="important-notice">
    <h4>Important</h4>
    <p>Please include this packing slip inside your package. Use the checkboxes to verify all cards are included before sealing. Final payout will be determined after we grade each card - you'll be notified of any adjustments.</p>
  </div>

  <div class="barcode">
    ${submission.submissionNumber}
  </div>

  <div class="footer">
    <p>Questions? Contact us at ${process.env.COMPANY_EMAIL || "support@cardforum.co.uk"}</p>
  </div>
</body>
</html>
`;
}

function generateErrorHTML(title: string, message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Error - ${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f3f4f6;
    }
    .error-box {
      text-align: center;
      padding: 48px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    h1 {
      color: #991b1b;
      margin: 0 0 16px;
    }
    p {
      color: #666;
    }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>
`;
}

function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Only GET is supported
export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
