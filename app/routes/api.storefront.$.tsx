/**
 * Shopify App Proxy Handler (Splat Route)
 *
 * This route handles all requests coming through Shopify's App Proxy.
 * The app proxy is configured in shopify.app.toml:
 *   [app_proxy]
 *   url = "/api/storefront"
 *   prefix = "apps"
 *   subpath = "trade-in"
 *
 * Customer URLs like https://{shop}.myshopify.com/apps/trade-in/track
 * are proxied to https://cardforum.vercel.app/api/storefront/track
 *
 * Shopify adds query params: shop, timestamp, signature, logged_in_customer_id, etc.
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  validateAppProxy,
  requireAppProxy,
  requireCustomer,
  jsonResponse,
  errorResponse,
} from "../lib/app-proxy.server";

// Import handlers from existing API routes
import { loader as trackLoader } from "./api.track";
import { loader as cardsSearchLoader } from "./api.cards.search";
import { loader as cardsBrowseLoader } from "./api.cards.browse";
import { loader as cardsSetsLoader } from "./api.cards.sets";
import { loader as submissionsLoader, action as submissionsAction } from "./api.submissions";
import { loader as packingSlipLoader } from "./api.packing-slip.$number";
import { loader as shippingInstructionsLoader } from "./api.shipping-instructions.$number";
import { loader as settingsPublicLoader } from "./api.settings.public";

// ============================================================================
// Route Matching
// ============================================================================

interface RouteMatch {
  handler: (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<Response>;
  params?: Record<string, string>;
}

function matchRoute(
  path: string,
  method: string
): RouteMatch | null {
  // Normalize path - remove leading slash
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const segments = normalizedPath.split("/").filter(Boolean);

  // Public settings
  // GET /settings
  if (segments[0] === "settings" && method === "GET") {
    return { handler: settingsPublicLoader };
  }

  // Track submission lookup
  // GET /track or /track?number=X
  if (segments[0] === "track" && method === "GET") {
    return { handler: trackLoader };
  }

  // Card search
  // GET /cards/search
  if (segments[0] === "cards" && segments[1] === "search" && method === "GET") {
    return { handler: cardsSearchLoader };
  }

  // Card browse
  // GET /cards/browse
  if (segments[0] === "cards" && segments[1] === "browse" && method === "GET") {
    return { handler: cardsBrowseLoader };
  }

  // Card sets
  // GET /cards/sets
  if (segments[0] === "cards" && segments[1] === "sets" && method === "GET") {
    return { handler: cardsSetsLoader };
  }

  // Submissions list/create
  // GET/POST /submissions
  if (segments[0] === "submissions" && segments.length === 1) {
    if (method === "GET") {
      return { handler: submissionsLoader };
    }
    if (method === "POST") {
      return { handler: submissionsAction };
    }
  }

  // Packing slip
  // GET /packing-slip/:number
  if (segments[0] === "packing-slip" && segments[1] && method === "GET") {
    return {
      handler: packingSlipLoader,
      params: { number: segments[1] },
    };
  }

  // Shipping instructions
  // GET /shipping-instructions/:number
  if (segments[0] === "shipping-instructions" && segments[1] && method === "GET") {
    return {
      handler: shippingInstructionsLoader,
      params: { number: segments[1] },
    };
  }

  return null;
}

// ============================================================================
// Loader (GET requests)
// ============================================================================

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Get the wildcard path from the splat param
  const splatPath = params["*"] || "";

  // Validate app proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid) {
    return errorResponse(401, "unauthorized", "Invalid app proxy signature");
  }

  // Match the route
  const match = matchRoute(splatPath, "GET");
  if (!match) {
    return errorResponse(404, "not_found", `Route not found: GET /${splatPath}`);
  }

  // Build args for the handler - merge route params with original args
  const handlerArgs = {
    request,
    params: { ...params, ...match.params },
    context: {},
  } as LoaderFunctionArgs;

  try {
    return await match.handler(handlerArgs);
  } catch (error) {
    console.error(`Storefront API error (GET /${splatPath}):`, error);

    // If it's already a Response, return it
    if (error instanceof Response) {
      return error;
    }

    return errorResponse(500, "internal_error", "An unexpected error occurred");
  }
}

// ============================================================================
// Action (POST, PUT, DELETE requests)
// ============================================================================

export async function action({ request, params }: ActionFunctionArgs) {
  // Get the wildcard path from the splat param
  const splatPath = params["*"] || "";
  const method = request.method;

  // Validate app proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid) {
    return errorResponse(401, "unauthorized", "Invalid app proxy signature");
  }

  // Match the route
  const match = matchRoute(splatPath, method);
  if (!match) {
    return errorResponse(404, "not_found", `Route not found: ${method} /${splatPath}`);
  }

  // Build args for the handler - merge route params with original args
  const handlerArgs = {
    request,
    params: { ...params, ...match.params },
    context: {},
  } as ActionFunctionArgs;

  try {
    return await match.handler(handlerArgs);
  } catch (error) {
    console.error(`Storefront API error (${method} /${splatPath}):`, error);

    // If it's already a Response, return it
    if (error instanceof Response) {
      return error;
    }

    return errorResponse(500, "internal_error", "An unexpected error occurred");
  }
}
