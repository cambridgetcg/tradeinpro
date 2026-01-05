/**
 * Authentication Middleware Layer
 *
 * Provides higher-order functions for route authentication that decouple
 * auth logic from individual route handlers.
 *
 * @synapse CODE_SYNAPSE.md - See ../lib/CODE_SYNAPSE.md for module dependencies
 *
 * USAGE:
 *   // In route file - wrap loader/action with auth middleware
 *   export const loader = withOptionalCustomer(async ({ request, auth }) => {
 *     if (auth.customer) {
 *       // Customer is logged in
 *     }
 *     return json({ ... });
 *   });
 *
 *   export const action = withRequiredCustomer(async ({ request, auth }) => {
 *     // auth.customer is guaranteed to exist
 *     return json({ ... });
 *   });
 *
 * MIGRATION:
 *   Routes can gradually adopt this middleware. Both patterns work:
 *   - Old: const ctx = await requireCustomer(request);
 *   - New: export const loader = withRequiredCustomer(handler);
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  validateAppProxy,
  requireCustomer,
  type AppProxyContext,
  type AppProxyContextWithCustomer,
  jsonResponse,
  errorResponse,
} from "../lib/app-proxy.server";

// ============================================================================
// Types
// ============================================================================

/**
 * Auth context for unauthenticated or optionally authenticated requests
 */
export interface OptionalAuthContext {
  /** Whether the request has a valid App Proxy signature */
  isValid: boolean;
  /** Shop domain */
  shop: string;
  /** Locale code */
  locale: string;
  /** Shopify customer ID (null if not logged in) */
  shopifyCustomerId: string | null;
  /** Internal customer ID (null if not logged in) */
  internalCustomerId: string | null;
  /** Whether customer is authenticated */
  isAuthenticated: boolean;
}

/**
 * Auth context for authenticated requests (customer required)
 */
export interface RequiredAuthContext extends OptionalAuthContext {
  shopifyCustomerId: string;
  internalCustomerId: string;
  isAuthenticated: true;
}

/**
 * Extended loader args with auth context
 */
export interface AuthenticatedLoaderArgs extends LoaderFunctionArgs {
  auth: RequiredAuthContext;
}

/**
 * Extended action args with auth context
 */
export interface AuthenticatedActionArgs extends ActionFunctionArgs {
  auth: RequiredAuthContext;
}

/**
 * Extended loader args with optional auth context
 */
export interface OptionalAuthLoaderArgs extends LoaderFunctionArgs {
  auth: OptionalAuthContext;
}

/**
 * Extended action args with optional auth context
 */
export interface OptionalAuthActionArgs extends ActionFunctionArgs {
  auth: OptionalAuthContext;
}

// ============================================================================
// Middleware Functions
// ============================================================================

/**
 * Wrap a loader with required customer authentication
 * Returns 401 if customer is not authenticated
 */
export function withRequiredCustomer<T>(
  handler: (args: AuthenticatedLoaderArgs) => Promise<T>
): (args: LoaderFunctionArgs) => Promise<T | Response> {
  return async (args: LoaderFunctionArgs) => {
    try {
      const customerContext = await requireCustomer(args.request);

      const auth: RequiredAuthContext = {
        isValid: true,
        shop: customerContext.shop,
        locale: customerContext.locale,
        shopifyCustomerId: customerContext.customerId,
        internalCustomerId: customerContext.internalCustomerId,
        isAuthenticated: true,
      };

      return handler({ ...args, auth });
    } catch (error) {
      // requireCustomer throws Response for auth failures
      if (error instanceof Response) {
        return error;
      }
      throw error;
    }
  };
}

/**
 * Wrap an action with required customer authentication
 * Returns 401 if customer is not authenticated
 */
export function withRequiredCustomerAction<T>(
  handler: (args: AuthenticatedActionArgs) => Promise<T>
): (args: ActionFunctionArgs) => Promise<T | Response> {
  return async (args: ActionFunctionArgs) => {
    try {
      const customerContext = await requireCustomer(args.request);

      const auth: RequiredAuthContext = {
        isValid: true,
        shop: customerContext.shop,
        locale: customerContext.locale,
        shopifyCustomerId: customerContext.customerId,
        internalCustomerId: customerContext.internalCustomerId,
        isAuthenticated: true,
      };

      return handler({ ...args, auth });
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      throw error;
    }
  };
}

/**
 * Wrap a loader with optional customer authentication
 * Validates App Proxy but doesn't require logged-in customer
 */
export function withOptionalCustomer<T>(
  handler: (args: OptionalAuthLoaderArgs) => Promise<T>
): (args: LoaderFunctionArgs) => Promise<T> {
  return async (args: LoaderFunctionArgs) => {
    const proxyContext = validateAppProxy(args.request);

    const auth: OptionalAuthContext = {
      isValid: proxyContext.isValid,
      shop: proxyContext.shop,
      locale: proxyContext.locale,
      shopifyCustomerId: proxyContext.customerId,
      internalCustomerId: null, // Not resolved for optional auth
      isAuthenticated: false,
    };

    return handler({ ...args, auth });
  };
}

/**
 * Wrap an action with optional customer authentication
 * Validates App Proxy but doesn't require logged-in customer
 */
export function withOptionalCustomerAction<T>(
  handler: (args: OptionalAuthActionArgs) => Promise<T>
): (args: ActionFunctionArgs) => Promise<T> {
  return async (args: ActionFunctionArgs) => {
    const proxyContext = validateAppProxy(args.request);

    const auth: OptionalAuthContext = {
      isValid: proxyContext.isValid,
      shop: proxyContext.shop,
      locale: proxyContext.locale,
      shopifyCustomerId: proxyContext.customerId,
      internalCustomerId: null,
      isAuthenticated: false,
    };

    return handler({ ...args, auth });
  };
}

/**
 * Wrap a loader with required App Proxy validation (no customer required)
 * Returns 401 if App Proxy signature is invalid
 */
export function withAppProxy<T>(
  handler: (args: OptionalAuthLoaderArgs) => Promise<T>
): (args: LoaderFunctionArgs) => Promise<T | Response> {
  return async (args: LoaderFunctionArgs) => {
    const proxyContext = validateAppProxy(args.request);

    if (!proxyContext.isValid && process.env.NODE_ENV === "production") {
      return errorResponse(401, "unauthorized", "Invalid request signature");
    }

    const auth: OptionalAuthContext = {
      isValid: proxyContext.isValid,
      shop: proxyContext.shop,
      locale: proxyContext.locale,
      shopifyCustomerId: proxyContext.customerId,
      internalCustomerId: null,
      isAuthenticated: !!proxyContext.customerId,
    };

    return handler({ ...args, auth });
  };
}

/**
 * Wrap an action with required App Proxy validation (no customer required)
 * Returns 401 if App Proxy signature is invalid
 */
export function withAppProxyAction<T>(
  handler: (args: OptionalAuthActionArgs) => Promise<T>
): (args: ActionFunctionArgs) => Promise<T | Response> {
  return async (args: ActionFunctionArgs) => {
    const proxyContext = validateAppProxy(args.request);

    if (!proxyContext.isValid && process.env.NODE_ENV === "production") {
      return errorResponse(401, "unauthorized", "Invalid request signature");
    }

    const auth: OptionalAuthContext = {
      isValid: proxyContext.isValid,
      shop: proxyContext.shop,
      locale: proxyContext.locale,
      shopifyCustomerId: proxyContext.customerId,
      internalCustomerId: null,
      isAuthenticated: !!proxyContext.customerId,
    };

    return handler({ ...args, auth });
  };
}
