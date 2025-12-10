/**
 * Shipping label generation and instructions
 * Integrates with Royal Mail Click & Drop API for prepaid labels
 * Falls back to self-ship instructions when Royal Mail is not configured
 */

import prisma from "../db.server";
import { formatPrice } from "./constants";
import {
  createRoyalMailService,
  estimatePackageWeight,
  getPackageFormat,
  formatUKPostcode,
  isValidUKPostcode,
  ROYAL_MAIL_SERVICES,
  type RoyalMailResult,
  type RoyalMailOrder,
} from "../services/royalMailApi.server";

// ============================================================================
// Types
// ============================================================================

export interface ReturnAddress {
  name: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface CustomerAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  postalCode: string;
  country: string;
}

export interface ShippingLabelRequest {
  submissionId: string;
  customerAddress?: CustomerAddress;
}

export interface ShippingLabel {
  labelUrl: string;
  trackingNumber: string;
  carrier: string;
  estimatedDelivery: string;
  instructions: string[];
}

export interface SelfShipInstructions {
  returnAddress: ReturnAddress | null;
  submissionNumber: string;
  quotedTotal: number;
  itemCount: number;
  instructions: string[];
  packingTips: string[];
  importantNotes: string[];
}

export interface ShippingSettings {
  shippingLabelEnabled: boolean;
  freeShippingMinimum: number;
  returnAddress: ReturnAddress | null;
  royalMailEnabled: boolean;
  royalMailService: string;
}

// ============================================================================
// Settings
// ============================================================================

/**
 * Get shipping-related settings
 */
export async function getShippingSettings(): Promise<ShippingSettings> {
  const settings = await prisma.tradeInSettings.findFirst();

  let returnAddress: ReturnAddress | null = null;
  if (settings?.returnAddress) {
    try {
      returnAddress = JSON.parse(settings.returnAddress);
    } catch {
      returnAddress = null;
    }
  }

  return {
    shippingLabelEnabled: settings?.shippingLabelEnabled ?? true,
    freeShippingMinimum: settings?.freeShippingMinimum ?? 5000,
    returnAddress,
    royalMailEnabled: settings?.royalMailEnabled ?? false,
    royalMailService: settings?.royalMailService ?? "TPN",
  };
}

/**
 * Update return address in settings
 */
export async function updateReturnAddress(
  address: ReturnAddress
): Promise<void> {
  const validation = validateReturnAddress(address);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const existing = await prisma.tradeInSettings.findFirst();

  if (existing) {
    await prisma.tradeInSettings.update({
      where: { id: existing.id },
      data: { returnAddress: JSON.stringify(address) },
    });
  } else {
    await prisma.tradeInSettings.create({
      data: { returnAddress: JSON.stringify(address) },
    });
  }
}

// ============================================================================
// Address Validation
// ============================================================================

/**
 * Validate return address has all required fields
 */
export function validateReturnAddress(
  address: Partial<ReturnAddress>
): { valid: boolean; error?: string } {
  if (!address.name?.trim()) {
    return { valid: false, error: "Name is required" };
  }
  if (!address.address1?.trim()) {
    return { valid: false, error: "Address line 1 is required" };
  }
  if (!address.city?.trim()) {
    return { valid: false, error: "City is required" };
  }
  if (!address.postalCode?.trim()) {
    return { valid: false, error: "Postal code is required" };
  }
  if (!address.country?.trim()) {
    return { valid: false, error: "Country is required" };
  }

  // Validate country code format (ISO 3166-1 alpha-2)
  if (address.country.length !== 2) {
    return {
      valid: false,
      error: "Country must be a 2-letter ISO code (e.g., GB, US)",
    };
  }

  return { valid: true };
}

/**
 * Format address for display
 */
export function formatAddress(address: ReturnAddress | null): string[] {
  if (!address) {
    return ["No return address configured"];
  }

  const lines: string[] = [];

  if (address.name) lines.push(address.name);
  if (address.company) lines.push(address.company);
  if (address.address1) lines.push(address.address1);
  if (address.address2) lines.push(address.address2);

  const cityLine = [address.city, address.province, address.postalCode]
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);

  if (address.country) {
    const countryName = getCountryName(address.country);
    lines.push(countryName);
  }

  return lines;
}

/**
 * Get full country name from ISO code
 */
function getCountryName(code: string): string {
  const countries: Record<string, string> = {
    GB: "United Kingdom",
    US: "United States",
    CA: "Canada",
    AU: "Australia",
    DE: "Germany",
    FR: "France",
    JP: "Japan",
    // Add more as needed
  };
  return countries[code.toUpperCase()] || code;
}

// ============================================================================
// Shipping Label Generation
// ============================================================================

/**
 * Generate a shipping label for a submission
 * Uses Royal Mail API if configured and submission qualifies for free shipping
 * Falls back to self-ship instructions otherwise
 */
export async function generateShippingLabel(
  request: ShippingLabelRequest
): Promise<ShippingLabel> {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: request.submissionId },
    include: { items: true, customer: true },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.status !== "SUBMITTED") {
    throw new Error("Shipping label can only be generated for submitted orders");
  }

  const settings = await getShippingSettings();

  if (!settings.returnAddress) {
    throw new Error("Return address not configured. Please contact support.");
  }

  // Check if submission qualifies for free prepaid shipping
  const qualifiesForFree = submission.quotedTotal >= settings.freeShippingMinimum;

  // Try Royal Mail API if:
  // 1. Royal Mail is enabled in settings
  // 2. Customer provided a valid address
  // 3. Submission qualifies for free shipping
  if (
    settings.royalMailEnabled &&
    qualifiesForFree &&
    request.customerAddress &&
    isValidUKPostcode(request.customerAddress.postalCode)
  ) {
    const royalMailResult = await generateRoyalMailLabel(
      submission,
      request.customerAddress,
      settings
    );

    if (royalMailResult.success) {
      return royalMailResult.data;
    }

    // Log the error but fall through to self-ship
    console.warn("Royal Mail label generation failed:", royalMailResult.error);
  }

  // Fallback: Generate internal tracking and HTML label
  const trackingNumber = generateTrackingNumber(submission.submissionNumber);

  // Store customer address if provided
  const addressUpdate = request.customerAddress
    ? {
        shippingName: request.customerAddress.name,
        shippingAddress1: request.customerAddress.address1,
        shippingAddress2: request.customerAddress.address2 || null,
        shippingCity: request.customerAddress.city,
        shippingPostalCode: request.customerAddress.postalCode,
        shippingCountry: request.customerAddress.country || "GB",
      }
    : {};

  // Update submission with shipping info
  await prisma.tradeInSubmission.update({
    where: { id: request.submissionId },
    data: {
      shippingMethod: qualifiesForFree ? "PREPAID" : "SELF_SHIP",
      trackingNumber,
      labelUrl: `/api/shipping/label/${request.submissionId}`,
      carrier: "Royal Mail",
      ...addressUpdate,
    },
  });

  return {
    labelUrl: `/api/shipping/label/${request.submissionId}`,
    trackingNumber,
    carrier: "Royal Mail Tracked",
    estimatedDelivery: "2-3 business days",
    instructions: qualifiesForFree
      ? [
          "Print this shipping label and attach it to your package",
          "Drop off at any Royal Mail Post Office or collection point",
          `Your tracking number is: ${trackingNumber}`,
          "Keep your receipt as proof of postage",
        ]
      : [
          "This submission does not qualify for free shipping",
          `Minimum value for free shipping: ${formatPrice(settings.freeShippingMinimum)}`,
          "Please use self-ship instructions instead",
        ],
  };
}

/**
 * Generate a Royal Mail shipping label via the Click & Drop API
 */
async function generateRoyalMailLabel(
  submission: {
    id: string;
    submissionNumber: string;
    quotedTotal: number;
    items: { quantity: number }[];
    customer: { email: string; firstName?: string | null; lastName?: string | null } | null;
  },
  customerAddress: CustomerAddress,
  settings: ShippingSettings
): Promise<RoyalMailResult<ShippingLabel>> {
  const royalMail = createRoyalMailService();

  if (!royalMail || !royalMail.isConfigured()) {
    return {
      success: false,
      error: {
        code: "NOT_CONFIGURED",
        message: "Royal Mail API is not configured",
      },
    };
  }

  if (!settings.returnAddress) {
    return {
      success: false,
      error: {
        code: "NO_RETURN_ADDRESS",
        message: "Return address not configured",
      },
    };
  }

  const itemCount = submission.items.reduce((sum, item) => sum + item.quantity, 0);
  const weight = estimatePackageWeight(itemCount);
  const packageFormat = getPackageFormat(itemCount);
  const customerName = customerAddress.name ||
    `${submission.customer?.firstName || ""} ${submission.customer?.lastName || ""}`.trim() ||
    "Customer";

  try {
    const result = await royalMail.createOrder({
      recipient: {
        fullName: customerName,
        address: {
          addressLine1: customerAddress.address1,
          addressLine2: customerAddress.address2,
          city: customerAddress.city,
          county: customerAddress.province,
          postcode: formatUKPostcode(customerAddress.postalCode),
          countryCode: customerAddress.country || "GB",
        },
        emailAddress: submission.customer?.email,
      },
      sender: {
        tradingName: settings.returnAddress.company || settings.returnAddress.name,
        companyName: settings.returnAddress.company,
        address: {
          addressLine1: settings.returnAddress.address1,
          addressLine2: settings.returnAddress.address2,
          city: settings.returnAddress.city,
          county: settings.returnAddress.province,
          postcode: formatUKPostcode(settings.returnAddress.postalCode),
          countryCode: settings.returnAddress.country || "GB",
        },
        telephoneNumber: settings.returnAddress.phone,
      },
      orderReference: submission.submissionNumber,
      orderDate: new Date().toISOString(),
      subtotal: submission.quotedTotal / 100, // Convert pence to pounds
      shippingCostCharged: 0,
      total: submission.quotedTotal / 100,
      currencyCode: "GBP",
      weightInGrams: weight,
      packageFormatIdentifier: packageFormat,
      serviceCode: settings.royalMailService || ROYAL_MAIL_SERVICES.TRACKED_48,
      includeLabelInResponse: true,
    });

    if (!result.success) {
      return result;
    }

    const order = result.data;
    const trackingNumber = order.trackingNumber || order.orderIdentifier;
    const labelPdf = order.label?.labelData || null;

    // Update submission with Royal Mail data
    await prisma.tradeInSubmission.update({
      where: { id: submission.id },
      data: {
        shippingMethod: "PREPAID",
        trackingNumber,
        royalMailOrderId: order.orderIdentifier,
        labelPdfBase64: labelPdf,
        labelGeneratedAt: new Date(),
        labelUrl: `/api/shipping/label/${submission.id}`,
        carrier: "Royal Mail",
        // Store customer address
        shippingName: customerName,
        shippingAddress1: customerAddress.address1,
        shippingAddress2: customerAddress.address2 || null,
        shippingCity: customerAddress.city,
        shippingPostalCode: formatUKPostcode(customerAddress.postalCode),
        shippingCountry: customerAddress.country || "GB",
      },
    });

    // Determine service name for display
    const serviceName =
      settings.royalMailService === ROYAL_MAIL_SERVICES.TRACKED_24
        ? "Royal Mail Tracked 24"
        : "Royal Mail Tracked 48";

    const estimatedDelivery =
      settings.royalMailService === ROYAL_MAIL_SERVICES.TRACKED_24
        ? "Next business day"
        : "2-3 business days";

    return {
      success: true,
      data: {
        labelUrl: `/api/shipping/label/${submission.id}`,
        trackingNumber,
        carrier: serviceName,
        estimatedDelivery,
        instructions: [
          "Print the attached shipping label",
          "Attach securely to your package",
          "Drop off at any Royal Mail Post Office or collection point",
          `Track your shipment: ${trackingNumber}`,
        ],
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "API_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}

/**
 * Generate a unique tracking number
 */
export function generateTrackingNumber(submissionNumber: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CF${timestamp}${random}`;
}

/**
 * Check if submission qualifies for free shipping
 */
export async function qualifiesForFreeShipping(
  submissionId: string
): Promise<{ qualifies: boolean; minimum: number; current: number }> {
  const [submission, settings] = await Promise.all([
    prisma.tradeInSubmission.findUnique({
      where: { id: submissionId },
    }),
    getShippingSettings(),
  ]);

  if (!submission) {
    throw new Error("Submission not found");
  }

  return {
    qualifies: submission.quotedTotal >= settings.freeShippingMinimum,
    minimum: settings.freeShippingMinimum,
    current: submission.quotedTotal,
  };
}

// ============================================================================
// Self-Ship Instructions
// ============================================================================

/**
 * Get self-ship instructions for a submission
 */
export async function getSelfShipInstructions(
  submissionId: string
): Promise<SelfShipInstructions> {
  const [submission, settings] = await Promise.all([
    prisma.tradeInSubmission.findUnique({
      where: { id: submissionId },
      include: { items: true },
    }),
    getShippingSettings(),
  ]);

  if (!submission) {
    throw new Error("Submission not found");
  }

  // Update submission to self-ship method
  if (!submission.shippingMethod) {
    await prisma.tradeInSubmission.update({
      where: { id: submissionId },
      data: { shippingMethod: "SELF_SHIP" },
    });
  }

  return {
    returnAddress: settings.returnAddress,
    submissionNumber: submission.submissionNumber,
    quotedTotal: submission.quotedTotal,
    itemCount: submission.items.length,
    instructions: [
      `Write "${submission.submissionNumber}" clearly on the outside of your package`,
      "Include a printed copy of your submission summary inside the package",
      "Use tracked shipping and save your tracking number",
      "Enter your tracking number on our website to update your submission",
    ],
    packingTips: [
      "Use penny sleeves and top loaders for valuable cards (£10+)",
      "Wrap cards in bubble wrap or soft padding material",
      "Use a rigid cardboard box to prevent bending",
      "Fill empty space with paper or bubble wrap",
      "Seal the package securely with strong tape",
    ],
    importantNotes: [
      `Total quoted value: ${formatPrice(submission.quotedTotal)}`,
      "Final value may change based on card condition assessment",
      "Keep proof of postage until your submission is complete",
      "Allow 1-3 business days for grading after we receive your package",
    ],
  };
}

// ============================================================================
// Tracking Updates
// ============================================================================

/**
 * Update tracking number for self-shipped submission
 */
export async function updateTrackingNumber(
  submissionId: string,
  trackingNumber: string,
  carrier?: string
): Promise<void> {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (!["SUBMITTED", "IN_TRANSIT"].includes(submission.status)) {
    throw new Error("Cannot update tracking for this submission status");
  }

  await prisma.tradeInSubmission.update({
    where: { id: submissionId },
    data: {
      trackingNumber,
      status: "IN_TRANSIT",
      carrier: carrier || submission.carrier || "Royal Mail",
    },
  });

  // Add system note about tracking update
  await prisma.submissionNote.create({
    data: {
      submissionId,
      authorType: "SYSTEM",
      message: `Tracking number updated: ${trackingNumber}${carrier ? ` (${carrier})` : ""}`,
    },
  });
}

/**
 * Mark package as received
 */
export async function markAsReceived(submissionId: string): Promise<void> {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (!["SUBMITTED", "IN_TRANSIT"].includes(submission.status)) {
    throw new Error("Cannot mark as received from current status");
  }

  await prisma.tradeInSubmission.update({
    where: { id: submissionId },
    data: {
      status: "RECEIVED",
      receivedAt: new Date(),
    },
  });
}

// ============================================================================
// Label Rendering (MVP)
// ============================================================================

/**
 * Generate printable label content (HTML)
 */
export async function generateLabelHTML(
  submissionId: string
): Promise<string> {
  const [submission, settings] = await Promise.all([
    prisma.tradeInSubmission.findUnique({
      where: { id: submissionId },
      include: { customer: true, items: true },
    }),
    getShippingSettings(),
  ]);

  if (!submission) {
    throw new Error("Submission not found");
  }

  const returnAddress = settings.returnAddress;
  if (!returnAddress) {
    throw new Error("Return address not configured");
  }

  const addressLines = formatAddress(returnAddress);

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Shipping Label - ${submission.submissionNumber}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
    }
    .label {
      border: 2px solid #000;
      padding: 20px;
      max-width: 400px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      border-bottom: 1px solid #ccc;
      padding-bottom: 10px;
      margin-bottom: 15px;
    }
    .header h1 {
      margin: 0;
      font-size: 18px;
    }
    .header p {
      margin: 5px 0 0;
      font-size: 12px;
      color: #666;
    }
    .address {
      margin-bottom: 15px;
    }
    .address-label {
      font-size: 10px;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .address-content {
      font-size: 14px;
      line-height: 1.4;
    }
    .reference {
      text-align: center;
      background: #f0f0f0;
      padding: 10px;
      margin-top: 15px;
    }
    .reference-label {
      font-size: 10px;
      color: #666;
    }
    .reference-value {
      font-size: 24px;
      font-weight: bold;
      font-family: monospace;
    }
    .barcode {
      text-align: center;
      margin-top: 15px;
      font-family: monospace;
      font-size: 12px;
    }
    .instructions {
      margin-top: 20px;
      border-top: 1px dashed #ccc;
      padding-top: 10px;
      font-size: 10px;
      color: #666;
    }
    @media print {
      body { margin: 0; padding: 10px; }
      .label { border: 3px solid #000; }
    }
  </style>
</head>
<body>
  <div class="label">
    <div class="header">
      <h1>TRADE-IN RETURN</h1>
      <p>CardForum Trading Card Trade-Ins</p>
    </div>

    <div class="address">
      <div class="address-label">Ship To:</div>
      <div class="address-content">
        ${addressLines.map((line) => `${line}<br>`).join("")}
      </div>
    </div>

    <div class="reference">
      <div class="reference-label">Reference Number</div>
      <div class="reference-value">${submission.submissionNumber}</div>
    </div>

    ${submission.trackingNumber ? `
    <div class="barcode">
      Tracking: ${submission.trackingNumber}
    </div>
    ` : ""}

    <div class="instructions">
      <strong>Instructions:</strong><br>
      1. Cut out this label along the border<br>
      2. Attach securely to your package<br>
      3. Drop off at any Royal Mail location<br>
      4. Keep your receipt as proof of postage
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate packing slip content (HTML)
 */
export async function generatePackingSlipHTML(
  submissionId: string
): Promise<string> {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
    include: {
      customer: true,
      items: {
        orderBy: { cardName: "asc" },
      },
    },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  const itemRows = submission.items
    .map(
      (item) => `
    <tr>
      <td>${item.cardName}</td>
      <td>${item.setName}${item.variant ? ` (${item.variant})` : ""}</td>
      <td>${item.conditionClaimed}</td>
      <td>${item.quantity}</td>
      <td>${formatPrice(item.quotedPrice)}</td>
    </tr>
  `
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Packing Slip - ${submission.submissionNumber}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
      font-size: 12px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #000;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .title {
      font-size: 20px;
      font-weight: bold;
    }
    .submission-info {
      text-align: right;
    }
    .submission-number {
      font-size: 16px;
      font-weight: bold;
      font-family: monospace;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background: #f0f0f0;
      font-weight: bold;
    }
    .totals {
      text-align: right;
      margin-top: 20px;
    }
    .totals table {
      width: auto;
      margin-left: auto;
    }
    .totals td {
      border: none;
      padding: 4px 10px;
    }
    .totals .total {
      font-weight: bold;
      font-size: 14px;
    }
    .notes {
      margin-top: 30px;
      padding: 15px;
      background: #f9f9f9;
      border: 1px solid #ddd;
    }
    @media print {
      body { margin: 0; padding: 10px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">Packing Slip</div>
      <div>CardForum Trade-In</div>
    </div>
    <div class="submission-info">
      <div class="submission-number">${submission.submissionNumber}</div>
      <div>${new Date(submission.createdAt).toLocaleDateString("en-GB")}</div>
    </div>
  </div>

  <div>
    <strong>Customer:</strong> ${submission.customer?.firstName || ""} ${submission.customer?.lastName || ""}<br>
    <strong>Email:</strong> ${submission.customer?.email || "N/A"}
  </div>

  <table>
    <thead>
      <tr>
        <th>Card Name</th>
        <th>Set</th>
        <th>Condition</th>
        <th>Qty</th>
        <th>Quote</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr>
        <td>Items:</td>
        <td>${submission.items.reduce((sum, i) => sum + i.quantity, 0)}</td>
      </tr>
      <tr>
        <td>Quoted Total:</td>
        <td>${formatPrice(submission.quotedTotal)}</td>
      </tr>
      ${submission.bonusAmount > 0 ? `
      <tr>
        <td>Store Credit Bonus:</td>
        <td>+${formatPrice(submission.bonusAmount)}</td>
      </tr>
      ` : ""}
      <tr class="total">
        <td>Expected Payout:</td>
        <td>${formatPrice(submission.quotedTotal + (submission.bonusAmount || 0))}</td>
      </tr>
    </table>
  </div>

  <div class="notes">
    <strong>Important Notes:</strong>
    <ul>
      <li>This is a <strong>quote</strong> - final value may change based on condition assessment</li>
      <li>Include this packing slip inside your package</li>
      <li>Payout type: ${submission.payoutType === "STORE_CREDIT" ? "Store Credit (includes bonus)" : submission.payoutType}</li>
      <li>Questions? Contact support@cardforum.co.uk</li>
    </ul>
  </div>
</body>
</html>
  `.trim();
}
