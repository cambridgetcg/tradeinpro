import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log("[app.tsx loader] Request:", {
    pathname: url.pathname,
    search: url.search,
    hasAuthHeader: !!request.headers.get("authorization"),
    hasCookie: !!request.headers.get("cookie"),
  });

  try {
    const authResult = await authenticate.admin(request);
    console.log("[app.tsx loader] Auth successful:", {
      shop: authResult.session?.shop,
      hasSession: !!authResult.session,
      sessionId: authResult.session?.id ? `${authResult.session.id.slice(0, 10)}...` : "none",
    });
  } catch (error) {
    console.error("[app.tsx loader] Auth failed:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 3) : undefined,
    });
    throw error;
  }

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  return { apiKey };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <PolarisProvider i18n={enTranslations}>
        <NavMenu>
          <Link to="/app" rel="home">Dashboard</Link>
          <Link to="/app/trade-ins">Trade-Ins</Link>
          <Link to="/app/prices">Prices</Link>
          <Link to="/app/payouts">Payouts</Link>
          <Link to="/app/settings">Settings</Link>
        </NavMenu>
        <Outlet />
      </PolarisProvider>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
