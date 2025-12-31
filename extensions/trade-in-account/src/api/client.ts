/**
 * API Client for Customer Account UI Extension
 *
 * Uses Shopify Session Token for OAuth 2.0 authentication.
 * The session token is a JWT containing the customer's GID in the 'sub' claim.
 *
 * IMPORTANT: Customer Account UI Extensions run in a sandboxed environment
 * with strict CSP. We must use the full shop URL (from session token's `dest` claim)
 * rather than relative URLs.
 *
 * @see https://shopify.dev/docs/api/customer-account-ui-extensions/apis/session-token
 */

import type { SubmissionsResponse, SubmissionDetailResponse } from '../types';
import { CONFIG } from '../config';

/**
 * API response wrapper for better error handling
 */
interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

/**
 * Build the full API URL using shop domain
 * CSP requires full URLs, not relative paths
 */
function buildApiUrl(shopDomain: string, path: string): string {
  // Ensure shop domain doesn't have protocol
  const cleanDomain = shopDomain.replace(/^https?:\/\//, '');
  return `https://${cleanDomain}${CONFIG.API_PROXY_PATH}${path}`;
}

/**
 * Generate a unique request ID for debugging
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Make an authenticated fetch request with timeout and retry support
 */
async function authenticatedFetch<T>(
  url: string,
  token: string | null,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const requestId = generateRequestId();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      ...options.headers,
    };

    // Add Authorization header if we have a session token
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    if (CONFIG.DEBUG_MODE) {
      console.log(`[API] ${options.method || 'GET'} ${url}`, { requestId, hasToken: !!token });
    }

    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || `HTTP ${response.status}`;

      if (CONFIG.DEBUG_MODE) {
        console.error(`[API] Error ${response.status}:`, errorData);
      }

      return {
        data: null,
        error: errorMessage,
        status: response.status,
      };
    }

    const data = await response.json();

    if (CONFIG.DEBUG_MODE) {
      console.log(`[API] Success:`, { requestId, status: response.status });
    }

    return {
      data,
      error: null,
      status: response.status,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === 'AbortError') {
      return {
        data: null,
        error: 'Request timeout',
        status: 408,
      };
    }

    const errorMessage = err instanceof Error ? err.message : 'Network error';
    console.error(`[API] Request failed:`, { requestId, error: errorMessage });

    return {
      data: null,
      error: errorMessage,
      status: 0,
    };
  }
}

/**
 * Fetch customer submissions with pagination and filtering
 */
export async function fetchSubmissions(
  token: string | null,
  shopDomain: string,
  params: {
    page?: number;
    limit?: number;
    status?: string;
  }
): Promise<SubmissionsResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.status) searchParams.set('status', params.status);

  const url = buildApiUrl(shopDomain, `/my-submissions?${searchParams}`);
  const response = await authenticatedFetch<SubmissionsResponse>(url, token);

  if (response.error) {
    throw new Error(response.error);
  }

  return response.data!;
}

/**
 * Fetch detailed information about a specific submission
 */
export async function fetchSubmissionDetail(
  token: string | null,
  shopDomain: string,
  submissionNumber: string
): Promise<SubmissionDetailResponse> {
  const url = buildApiUrl(shopDomain, `/my-submissions/${submissionNumber}`);
  const response = await authenticatedFetch<SubmissionDetailResponse>(url, token);

  if (response.error) {
    throw new Error(response.error);
  }

  return response.data!;
}

/**
 * Perform an action on a submission (accept, reject, or cancel)
 */
export async function submitAction(
  token: string | null,
  shopDomain: string,
  submissionNumber: string,
  action: 'accept' | 'reject' | 'cancel',
  data?: { reason?: string; trackingNumber?: string }
): Promise<{ success: boolean; message: string }> {
  const url = buildApiUrl(shopDomain, `/my-submissions/${submissionNumber}/action`);
  const response = await authenticatedFetch<{ success: boolean; message: string }>(
    url,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ action, ...data }),
    }
  );

  if (response.error) {
    throw new Error(response.error);
  }

  return response.data!;
}

/**
 * API Client class for more structured usage
 */
export class TradeInApiClient {
  private token: string | null = null;
  private shopDomain: string = '';

  setToken(token: string | null) {
    this.token = token;
  }

  setShopDomain(shopDomain: string) {
    this.shopDomain = shopDomain;
  }

  async getSubmissions(params: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<SubmissionsResponse> {
    return fetchSubmissions(this.token, this.shopDomain, params);
  }

  async getSubmissionDetail(submissionNumber: string): Promise<SubmissionDetailResponse> {
    return fetchSubmissionDetail(this.token, this.shopDomain, submissionNumber);
  }

  async performAction(
    submissionNumber: string,
    action: 'accept' | 'reject' | 'cancel',
    data?: { reason?: string; trackingNumber?: string }
  ): Promise<{ success: boolean; message: string }> {
    return submitAction(this.token, this.shopDomain, submissionNumber, action, data);
  }
}
