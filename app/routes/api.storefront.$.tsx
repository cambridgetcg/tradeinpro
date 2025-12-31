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
import { loader as cardsGamesLoader } from "./api.cards.games";
import { loader as cardsLanguagesLoader } from "./api.cards.languages";
import { loader as submissionsLoader, action as submissionsAction } from "./api.submissions";
import { loader as packingSlipLoader } from "./api.packing-slip.$number";
import { loader as shippingInstructionsLoader } from "./api.shipping-instructions.$number";
import { loader as settingsPublicLoader } from "./api.settings.public";
// Customer Account Extension endpoints (my-submissions)
import { loader as mySubmissionsLoader } from "./api.my-submissions";
import { loader as mySubmissionDetailLoader } from "./api.my-submissions.$number";
import { action as mySubmissionActionHandler } from "./api.my-submissions.$number.action";

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

  // Card games
  // GET /cards/games
  if (segments[0] === "cards" && segments[1] === "games" && method === "GET") {
    return { handler: cardsGamesLoader };
  }

  // Card languages
  // GET /cards/languages
  if (segments[0] === "cards" && segments[1] === "languages" && method === "GET") {
    return { handler: cardsLanguagesLoader };
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

  // ============================================================================
  // Customer Account Extension Routes (my-submissions)
  // ============================================================================

  // My submissions list (logged-in customer)
  // GET /my-submissions
  if (segments[0] === "my-submissions" && segments.length === 1 && method === "GET") {
    return { handler: mySubmissionsLoader };
  }

  // My submission detail
  // GET /my-submissions/:number
  if (segments[0] === "my-submissions" && segments.length === 2 && segments[1] !== "action" && method === "GET") {
    return {
      handler: mySubmissionDetailLoader,
      params: { number: segments[1] },
    };
  }

  // My submission action (accept/reject/cancel)
  // POST /my-submissions/:number/action
  if (segments[0] === "my-submissions" && segments.length === 3 && segments[2] === "action" && method === "POST") {
    return {
      handler: mySubmissionActionHandler,
      params: { number: segments[1] },
    };
  }

  return null;
}

// ============================================================================
// Routes that support Session Token auth (Customer Account UI Extensions)
// ============================================================================

const SESSION_TOKEN_ROUTES = ["my-submissions"];

function isSessionTokenRoute(path: string): boolean {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const firstSegment = normalizedPath.split("/")[0];
  return SESSION_TOKEN_ROUTES.includes(firstSegment);
}

// ============================================================================
// Loader (GET requests)
// ============================================================================

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Get the wildcard path from the splat param
  const splatPath = params["*"] || "";
  const url = new URL(request.url);
  const hasAuthHeader = request.headers.has("Authorization");
  const hasAppProxyParams = url.searchParams.has("signature");

  console.log(`[Storefront API] GET /${splatPath}`, {
    hasAuthHeader,
    hasAppProxyParams,
    isSessionTokenRoute: isSessionTokenRoute(splatPath),
  });

  // For Session Token routes (my-submissions), allow Bearer token auth
  // The handler will validate the token via requireCustomer()
  if (isSessionTokenRoute(splatPath)) {
    // Check if we have either App Proxy signature OR Authorization header
    if (!hasAppProxyParams && !hasAuthHeader) {
      console.warn(`[Storefront API] No auth method provided for ${splatPath}`);
      return errorResponse(401, "unauthorized", "Authentication required");
    }

    // If App Proxy params exist, validate them
    if (hasAppProxyParams) {
      const context = validateAppProxy(request);
      if (!context.isValid) {
        console.warn(`[Storefront API] Invalid App Proxy signature for ${splatPath}`);
        return errorResponse(401, "unauthorized", "Invalid app proxy signature");
      }
      console.log(`[Storefront API] App Proxy auth valid for ${splatPath}`);
    } else {
      console.log(`[Storefront API] Using Bearer token auth for ${splatPath}`);
    }
  } else {
    // Non-session-token routes require App Proxy validation
    const context = validateAppProxy(request);
    if (!context.isValid) {
      console.warn(`[Storefront API] Invalid App Proxy signature for ${splatPath}`);
      return errorResponse(401, "unauthorized", "Invalid app proxy signature");
    }
  }

  // Match the route
  const match = matchRoute(splatPath, "GET");
  if (!match) {
    console.warn(`[Storefront API] Route not found: GET /${splatPath}`);
    return errorResponse(404, "not_found", `Route not found: GET /${splatPath}`);
  }

  // Build args for the handler - merge route params with original args
  const handlerArgs = {
    request,
    params: { ...params, ...match.params },
    context: {},
  } as LoaderFunctionArgs;

  try {
    console.log(`[Storefront API] Calling handler for GET /${splatPath}`);
    return await match.handler(handlerArgs);
  } catch (error) {
    console.error(`[Storefront API] Error (GET /${splatPath}):`, error);

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
  const url = new URL(request.url);
  const hasAuthHeader = request.headers.has("Authorization");
  const hasAppProxyParams = url.searchParams.has("signature");

  console.log(`[Storefront API] ${method} /${splatPath}`, {
    hasAuthHeader,
    hasAppProxyParams,
    isSessionTokenRoute: isSessionTokenRoute(splatPath),
  });

  // For Session Token routes (my-submissions), allow Bearer token auth
  if (isSessionTokenRoute(splatPath)) {
    if (!hasAppProxyParams && !hasAuthHeader) {
      console.warn(`[Storefront API] No auth method provided for ${splatPath}`);
      return errorResponse(401, "unauthorized", "Authentication required");
    }

    if (hasAppProxyParams) {
      const context = validateAppProxy(request);
      if (!context.isValid) {
        console.warn(`[Storefront API] Invalid App Proxy signature for ${splatPath}`);
        return errorResponse(401, "unauthorized", "Invalid app proxy signature");
      }
      console.log(`[Storefront API] App Proxy auth valid for ${splatPath}`);
    } else {
      console.log(`[Storefront API] Using Bearer token auth for ${splatPath}`);
    }
  } else {
    const context = validateAppProxy(request);
    if (!context.isValid) {
      console.warn(`[Storefront API] Invalid App Proxy signature for ${splatPath}`);
      return errorResponse(401, "unauthorized", "Invalid app proxy signature");
    }
  }

  // Match the route
  const match = matchRoute(splatPath, method);
  if (!match) {
    console.warn(`[Storefront API] Route not found: ${method} /${splatPath}`);
    return errorResponse(404, "not_found", `Route not found: ${method} /${splatPath}`);
  }

  // Build args for the handler - merge route params with original args
  const handlerArgs = {
    request,
    params: { ...params, ...match.params },
    context: {},
  } as ActionFunctionArgs;

  try {
    console.log(`[Storefront API] Calling handler for ${method} /${splatPath}`);
    return await match.handler(handlerArgs);
  } catch (error) {
    console.error(`[Storefront API] Error (${method} /${splatPath}):`, error);

    // If it's already a Response, return it
    if (error instanceof Response) {
      return error;
    }

    return errorResponse(500, "internal_error", "An unexpected error occurred");
  }
}
