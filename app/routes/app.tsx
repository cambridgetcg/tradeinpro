import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[CARDFORUM] app.tsx loader - Request URL:", request.url);
  console.log("[CARDFORUM] app.tsx loader - Authenticating...");

  try {
    await authenticate.admin(request);
    console.log("[CARDFORUM] app.tsx loader - Authentication successful");
  } catch (error) {
    console.error("[CARDFORUM] app.tsx loader - Authentication failed:", error);
    throw error;
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/trade-ins">Trade-Ins</s-link>
        <s-link href="/app/buylist">Buylist</s-link>
        <s-link href="/app/prices">Prices</s-link>
        <s-link href="/app/inventory">Inventory</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
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
