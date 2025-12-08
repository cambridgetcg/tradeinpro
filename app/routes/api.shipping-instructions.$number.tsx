/**
 * Public Shipping Instructions API
 *
 * GET /apps/trade-in/shipping-instructions/:number
 *
 * Public endpoint for customers to view/print their shipping instructions.
 * Includes return address, packing tips, and checklist.
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import prisma from "../db.server";
import { formatPrice } from "../lib/constants";
import {
  getShippingSettings,
  formatAddress,
  qualifiesForFreeShipping,
} from "../lib/shipping.server";

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
        items: {
          select: {
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

    // Check if qualifies for free shipping
    const freeShipping = await qualifiesForFreeShipping(submission.id);
    const totalItems = submission.items.reduce((sum, i) => sum + i.quantity, 0);

    // Generate printable HTML
    const html = generateShippingInstructionsHTML({
      submissionNumber: submission.submissionNumber,
      returnAddress: addressLines,
      quotedTotal: submission.quotedTotal,
      totalItems,
      freeShipping: freeShipping.qualifies,
      freeShippingMinimum: settings.freeShippingMinimum,
      trackingNumber: submission.trackingNumber,
    });

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="shipping-instructions-${submissionNumber}.html"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Shipping instructions error:", error);
    return errorResponse(500, "generation_failed", "Failed to generate shipping instructions");
  }
}

// ============================================================================
// HTML Generation
// ============================================================================

interface ShippingData {
  submissionNumber: string;
  returnAddress: string[];
  quotedTotal: number;
  totalItems: number;
  freeShipping: boolean;
  freeShippingMinimum: number;
  trackingNumber: string | null;
}

function generateShippingInstructionsHTML(data: ShippingData): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shipping Instructions - ${data.submissionNumber}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 24px;
      max-width: 700px;
      margin: 0 auto;
      color: #111;
      font-size: 15px;
      line-height: 1.6;
      background: #f9fafb;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: #111;
      color: white;
      padding: 24px 32px;
      text-align: center;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .header .ref {
      font-family: 'Courier New', monospace;
      font-size: 16px;
      opacity: 0.9;
    }
    .content {
      padding: 32px;
    }
    .section {
      margin-bottom: 32px;
    }
    .section:last-child {
      margin-bottom: 0;
    }
    .section-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #666;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title svg {
      width: 20px;
      height: 20px;
    }
    .address-card {
      background: #f3f4f6;
      border-radius: 8px;
      padding: 24px;
      text-align: center;
    }
    .address-card p {
      font-size: 16px;
      margin: 4px 0;
    }
    .address-card .company {
      font-weight: 700;
      font-size: 18px;
    }
    .checklist {
      list-style: none;
    }
    .checklist li {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .checklist li:last-child {
      border-bottom: none;
    }
    .checklist .check {
      width: 24px;
      height: 24px;
      border: 2px solid #d1d5db;
      border-radius: 4px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .checklist .text strong {
      display: block;
      margin-bottom: 2px;
    }
    .checklist .text span {
      color: #666;
      font-size: 14px;
    }
    .tips {
      background: #ecfdf5;
      border-radius: 8px;
      padding: 20px;
    }
    .tips h4 {
      color: #065f46;
      margin-bottom: 12px;
      font-size: 15px;
    }
    .tips ul {
      margin-left: 20px;
      color: #047857;
    }
    .tips li {
      margin: 8px 0;
    }
    .warning {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 20px;
      display: flex;
      gap: 12px;
    }
    .warning svg {
      width: 24px;
      height: 24px;
      color: #d97706;
      flex-shrink: 0;
    }
    .warning-content h4 {
      color: #92400e;
      margin-bottom: 4px;
    }
    .warning-content p {
      color: #78350f;
      font-size: 14px;
    }
    .free-shipping-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #10b981;
      color: white;
      padding: 8px 16px;
      border-radius: 999px;
      font-weight: 600;
      font-size: 14px;
      margin-top: 16px;
    }
    .free-shipping-badge svg {
      width: 18px;
      height: 18px;
    }
    .summary {
      display: flex;
      justify-content: space-between;
      padding: 16px;
      background: #f3f4f6;
      border-radius: 8px;
      margin-bottom: 24px;
    }
    .summary-item {
      text-align: center;
    }
    .summary-item .value {
      font-size: 20px;
      font-weight: 700;
    }
    .summary-item .label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .cta {
      text-align: center;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    .cta-btn {
      display: inline-block;
      background: #111;
      color: white;
      padding: 14px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      transition: background 0.2s;
    }
    .cta-btn:hover {
      background: #333;
    }
    .cta-hint {
      margin-top: 12px;
      font-size: 13px;
      color: #666;
    }
    .footer {
      text-align: center;
      padding: 20px;
      background: #f3f4f6;
      color: #666;
      font-size: 13px;
    }
    @media print {
      body {
        padding: 0;
        background: white;
      }
      .container {
        box-shadow: none;
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
  <button class="print-btn no-print" onclick="window.print()">Print Instructions</button>

  <div class="container">
    <div class="header">
      <h1>Shipping Instructions</h1>
      <div class="ref">${data.submissionNumber}</div>
    </div>

    <div class="content">
      <div class="summary">
        <div class="summary-item">
          <div class="value">${data.totalItems}</div>
          <div class="label">Cards</div>
        </div>
        <div class="summary-item">
          <div class="value">${formatPrice(data.quotedTotal)}</div>
          <div class="label">Quoted Value</div>
        </div>
        <div class="summary-item">
          <div class="value">${data.freeShipping ? "FREE" : "Self-Ship"}</div>
          <div class="label">Shipping</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
            <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          Ship To
        </div>
        <div class="address-card">
          ${data.returnAddress.map((line, i) => `<p${i === 0 ? ' class="company"' : ''}>${escapeHtml(line)}</p>`).join("")}
          ${
            data.freeShipping
              ? `<span class="free-shipping-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 13l4 4L19 7"/>
                  </svg>
                  Free Shipping Included
                </span>`
              : ""
          }
        </div>
      </div>

      <div class="section">
        <div class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          Packing Checklist
        </div>
        <ul class="checklist">
          <li>
            <div class="check"></div>
            <div class="text">
              <strong>Sleeve each card individually</strong>
              <span>Use penny sleeves to protect from scratches</span>
            </div>
          </li>
          <li>
            <div class="check"></div>
            <div class="text">
              <strong>Use toploaders for valuable cards (${formatPrice(5000)}+)</strong>
              <span>Extra protection for high-value cards prevents damage</span>
            </div>
          </li>
          <li>
            <div class="check"></div>
            <div class="text">
              <strong>Secure cards to prevent movement</strong>
              <span>Tape sleeves/toploaders together or use cardboard</span>
            </div>
          </li>
          <li>
            <div class="check"></div>
            <div class="text">
              <strong>Include your packing slip</strong>
              <span>This ensures quick processing when we receive your cards</span>
            </div>
          </li>
          <li>
            <div class="check"></div>
            <div class="text">
              <strong>Seal package securely</strong>
              <span>Use tape to ensure package stays closed in transit</span>
            </div>
          </li>
        </ul>
      </div>

      <div class="section">
        <div class="tips">
          <h4>Pro Tips</h4>
          <ul>
            <li>Take photos of your cards before shipping for your records</li>
            <li>Use tracked shipping for peace of mind</li>
            <li>Ship cards face-to-face (not back-to-back) to prevent surface damage</li>
            <li>Avoid shipping in extreme weather when possible</li>
          </ul>
        </div>
      </div>

      <div class="section">
        <div class="warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <div class="warning-content">
            <h4>Important</h4>
            <p>Final payout is determined after we grade each card. If any cards are in different condition than claimed, we'll notify you before processing payment.</p>
          </div>
        </div>
      </div>

      <div class="cta">
        <a href="/apps/trade-in/packing-slip/${data.submissionNumber}" class="cta-btn no-print">
          Download Packing Slip
        </a>
        <p class="cta-hint">Include the packing slip in your package</p>
      </div>
    </div>

    <div class="footer">
      Questions? Contact us at ${process.env.COMPANY_EMAIL || "support@cardforum.co.uk"}
    </div>
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
