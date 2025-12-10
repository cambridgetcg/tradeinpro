/**
 * Royal Mail Click & Drop API Client
 *
 * Generates prepaid shipping labels for trade-in submissions.
 * API Documentation: https://developer.royalmail.net/api
 *
 * Requires ROYAL_MAIL_API_KEY environment variable from Click & Drop dashboard.
 */

const API_BASE_URL =
  process.env.ROYAL_MAIL_BASE_URL || "https://api.parcel.royalmail.com";
const API_KEY = process.env.ROYAL_MAIL_API_KEY || "";

// Rate limit: 2 requests per second for Click & Drop
const RATE_LIMIT_DELAY_MS = 500;

// ============================================================================
// Types
// ============================================================================

export interface RoyalMailAddress {
  addressLine1: string;
  addressLine2?: string;
  addressLine3?: string;
  city: string;
  county?: string;
  postcode: string;
  countryCode: string; // ISO 3166-1 alpha-2, e.g., "GB"
}

export interface RoyalMailRecipient {
  fullName: string;
  companyName?: string;
  address: RoyalMailAddress;
  emailAddress?: string;
  telephoneNumber?: string;
}

export interface RoyalMailSender {
  tradingName: string;
  companyName?: string;
  address: RoyalMailAddress;
  emailAddress?: string;
  telephoneNumber?: string;
}

export interface CreateOrderRequest {
  recipient: RoyalMailRecipient;
  sender: RoyalMailSender;
  orderReference: string;
  orderDate: string; // ISO 8601 date
  subtotal: number;
  shippingCostCharged: number;
  total: number;
  currencyCode: string;
  weightInGrams: number;
  packageFormatIdentifier: string; // e.g., "parcel" or "largeLetter"
  serviceCode: string; // e.g., "TPN" for Tracked 48
  requiresSignature?: boolean;
  includeLabelInResponse: boolean;
}

export interface RoyalMailOrder {
  orderIdentifier: string;
  orderReference: string;
  createdOn: string;
  label?: {
    labelData: string; // Base64 encoded PDF
    labelFormat: string;
  };
  trackingNumber?: string;
  status: string;
}

export interface RoyalMailOrderResponse {
  successCount: number;
  failureCount: number;
  createdOrders?: RoyalMailOrder[];
  failedOrders?: Array<{
    orderReference: string;
    errorCode: string;
    errorMessage: string;
  }>;
}

export interface RoyalMailLabelResponse {
  labelData: string; // Base64 encoded PDF
  labelFormat: string;
}

export interface TrackingEvent {
  timestamp: string;
  status: string;
  location?: string;
  description: string;
}

export interface TrackingInfo {
  trackingNumber: string;
  status: string;
  estimatedDelivery?: string;
  events: TrackingEvent[];
}

export interface RoyalMailError {
  code: string;
  message: string;
  details?: string;
}

export type RoyalMailResult<T> =
  | { success: true; data: T }
  | { success: false; error: RoyalMailError };

// ============================================================================
// Service Class
// ============================================================================

export class RoyalMailService {
  private apiKey: string;
  private baseUrl: string;
  private lastRequestTime: number = 0;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || API_KEY;
    this.baseUrl = baseUrl || API_BASE_URL;
  }

  /**
   * Check if the service is properly configured
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Rate limit helper - ensures we don't exceed 2 requests/second
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastRequest)
      );
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<RoyalMailResult<T>> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: {
          code: "NOT_CONFIGURED",
          message: "Royal Mail API key not configured",
        },
      };
    }

    await this.rateLimit();

    try {
      const url = `${this.baseUrl}${endpoint}`;
      const options: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message:
              errorData.message || `HTTP ${response.status} ${response.statusText}`,
            details: JSON.stringify(errorData),
          },
        };
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return { success: true, data: {} as T };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message:
            error instanceof Error ? error.message : "Unknown network error",
        },
      };
    }
  }

  /**
   * Create a shipping order and optionally get the label
   */
  async createOrder(
    request: CreateOrderRequest
  ): Promise<RoyalMailResult<RoyalMailOrder>> {
    const orderPayload = {
      items: [
        {
          orderReference: request.orderReference,
          recipient: {
            fullName: request.recipient.fullName,
            companyName: request.recipient.companyName,
            addressLine1: request.recipient.address.addressLine1,
            addressLine2: request.recipient.address.addressLine2,
            addressLine3: request.recipient.address.addressLine3,
            city: request.recipient.address.city,
            county: request.recipient.address.county,
            postcode: request.recipient.address.postcode,
            countryCode: request.recipient.address.countryCode,
            emailAddress: request.recipient.emailAddress,
            telephoneNumber: request.recipient.telephoneNumber,
          },
          sender: {
            tradingName: request.sender.tradingName,
            companyName: request.sender.companyName,
            addressLine1: request.sender.address.addressLine1,
            addressLine2: request.sender.address.addressLine2,
            city: request.sender.address.city,
            county: request.sender.address.county,
            postcode: request.sender.address.postcode,
            countryCode: request.sender.address.countryCode,
            emailAddress: request.sender.emailAddress,
            telephoneNumber: request.sender.telephoneNumber,
          },
          orderDate: request.orderDate,
          subtotal: request.subtotal,
          shippingCostCharged: request.shippingCostCharged,
          total: request.total,
          currencyCode: request.currencyCode,
          packages: [
            {
              weightInGrams: request.weightInGrams,
              packageFormatIdentifier: request.packageFormatIdentifier,
              contents: [
                {
                  name: "Trading Cards",
                  quantity: 1,
                  unitValue: request.subtotal,
                  unitWeightInGrams: request.weightInGrams,
                },
              ],
            },
          ],
          label: {
            includeLabelInResponse: request.includeLabelInResponse,
          },
          postageDetails: {
            serviceCode: request.serviceCode,
            receiveEmailNotification: true,
            requiresSignature: request.requiresSignature ?? false,
          },
        },
      ],
    };

    const result = await this.request<RoyalMailOrderResponse>(
      "POST",
      "/api/v1/orders",
      orderPayload
    );

    if (!result.success) {
      return result;
    }

    const response = result.data;

    // Check for failed orders
    if (response.failureCount > 0 && response.failedOrders?.length) {
      const failure = response.failedOrders[0];
      return {
        success: false,
        error: {
          code: failure.errorCode || "ORDER_FAILED",
          message: failure.errorMessage || "Failed to create order",
        },
      };
    }

    // Get the created order
    if (response.successCount > 0 && response.createdOrders?.length) {
      return { success: true, data: response.createdOrders[0] };
    }

    return {
      success: false,
      error: {
        code: "NO_ORDER_CREATED",
        message: "No order was created",
      },
    };
  }

  /**
   * Get the shipping label for an existing order
   */
  async getLabel(orderIdentifier: string): Promise<RoyalMailResult<string>> {
    const result = await this.request<RoyalMailLabelResponse>(
      "GET",
      `/api/v1/orders/${encodeURIComponent(orderIdentifier)}/label`
    );

    if (!result.success) {
      return result;
    }

    return { success: true, data: result.data.labelData };
  }

  /**
   * Get tracking information for a shipment
   */
  async getTracking(trackingNumber: string): Promise<RoyalMailResult<TrackingInfo>> {
    // Note: Royal Mail tracking may require a separate API endpoint or the
    // Track & Trace API. For now, return a placeholder structure.
    const result = await this.request<{ tracking: TrackingInfo }>(
      "GET",
      `/api/v1/tracking/${encodeURIComponent(trackingNumber)}`
    );

    if (!result.success) {
      return result;
    }

    return { success: true, data: result.data.tracking };
  }

  /**
   * Delete/cancel an order (labels become invalid)
   */
  async deleteOrder(orderIdentifier: string): Promise<RoyalMailResult<void>> {
    return this.request<void>(
      "DELETE",
      `/api/v1/orders/${encodeURIComponent(orderIdentifier)}`
    );
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let serviceInstance: RoyalMailService | null = null;

/**
 * Get a configured Royal Mail service instance
 * Returns null if API key is not configured
 */
export function createRoyalMailService(): RoyalMailService | null {
  if (!API_KEY) {
    return null;
  }

  if (!serviceInstance) {
    serviceInstance = new RoyalMailService();
  }

  return serviceInstance;
}

/**
 * Get a Royal Mail service instance (always returns an instance, even if not configured)
 * Use isConfigured() to check if it can make API calls
 */
export function getRoyalMailService(): RoyalMailService {
  if (!serviceInstance) {
    serviceInstance = new RoyalMailService();
  }
  return serviceInstance;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Royal Mail service codes
 */
export const ROYAL_MAIL_SERVICES = {
  TRACKED_24: "TPS", // Tracked 24 (next day)
  TRACKED_48: "TPN", // Tracked 48 (2-3 days)
  SPECIAL_DELIVERY_9AM: "SD1", // Special Delivery Guaranteed by 9am
  SPECIAL_DELIVERY_1PM: "SD2", // Special Delivery Guaranteed by 1pm
} as const;

export type RoyalMailServiceCode =
  (typeof ROYAL_MAIL_SERVICES)[keyof typeof ROYAL_MAIL_SERVICES];

/**
 * Estimate package weight based on number of cards
 * Trading cards typically weigh ~1.8g each, plus packaging
 */
export function estimatePackageWeight(itemCount: number): number {
  const cardWeight = 2; // grams per card (with sleeve)
  const packagingWeight = 50; // base packaging weight (envelope/box)
  const topLoaderWeight = 15; // top loader per 10 cards

  const totalCardWeight = itemCount * cardWeight;
  const topLoaders = Math.ceil(itemCount / 10) * topLoaderWeight;

  return packagingWeight + totalCardWeight + topLoaders;
}

/**
 * Determine package format based on item count
 */
export function getPackageFormat(itemCount: number): string {
  // Large letter can hold up to ~20 cards with top loaders
  // Parcel for larger submissions
  if (itemCount <= 20) {
    return "largeLetter";
  }
  return "parcel";
}

/**
 * Validate UK postcode format
 */
export function isValidUKPostcode(postcode: string): boolean {
  // UK postcode regex (simplified)
  const postcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
  return postcodeRegex.test(postcode.trim());
}

/**
 * Format postcode to standard UK format
 */
export function formatUKPostcode(postcode: string): string {
  const cleaned = postcode.toUpperCase().replace(/\s/g, "");
  // Insert space before last 3 characters
  if (cleaned.length > 3) {
    return `${cleaned.slice(0, -3)} ${cleaned.slice(-3)}`;
  }
  return cleaned;
}
