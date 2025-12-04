import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[CARDFORUM] ========== APP.TSX LOADER START ==========");
  console.log("[CARDFORUM] Request URL:", request.url);
  console.log("[CARDFORUM] Request method:", request.method);
  console.log("[CARDFORUM] SHOPIFY_API_KEY exists:", !!process.env.SHOPIFY_API_KEY);
  console.log("[CARDFORUM] DATABASE_URL exists:", !!process.env.DATABASE_URL);

  try {
    console.log("[CARDFORUM] Calling authenticate.admin...");
    const authResult = await authenticate.admin(request);
    console.log("[CARDFORUM] Auth successful! Session:", authResult?.session?.shop);

    const apiKey = process.env.SHOPIFY_API_KEY || "";
    console.log("[CARDFORUM] Returning apiKey (length):", apiKey.length);
    console.log("[CARDFORUM] ========== APP.TSX LOADER END ==========");

    return { apiKey };
  } catch (error) {
    // If authenticate.admin throws a Response (redirect for token exchange), return it
    if (error instanceof Response) {
      console.log("[CARDFORUM] Auth threw Response - status:", error.status);
      console.log("[CARDFORUM] Response headers:", Object.fromEntries(error.headers.entries()));
      // For redirects, we need to throw, not return
      throw error;
    }
    console.error("[CARDFORUM] Auth error (non-Response):", error);
    throw error;
  }
};

export default function App() {
  const loaderData = useLoaderData<typeof loader>();
  console.log("[CARDFORUM] App component rendering, loaderData:", loaderData);

  const apiKey = loaderData?.apiKey || "";

  if (!apiKey) {
    console.error("[CARDFORUM] No API key in loaderData!");
    return <div style={{ padding: "20px", color: "red" }}>Error: No API key configured</div>;
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/trade-ins">Trade-Ins</Link>
        <Link to="/app/buylist">Buylist</Link>
        <Link to="/app/prices">Prices</Link>
        <Link to="/app/inventory">Inventory</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
