import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

// Export Polaris styles for the app
export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log("[app.tsx loader] Request:", {
    pathname: url.pathname,
    search: url.search,
    host: url.searchParams.get("host"),
    hasAuthHeader: !!request.headers.get("authorization"),
    hasCookie: !!request.headers.get("cookie"),
  });

  try {
    // Handle Response throws from authenticate (like redirects)
    let authResult;
    try {
      authResult = await authenticate.admin(request);
    } catch (authError) {
      if (authError instanceof Response) {
        console.log("[app.tsx loader] Auth threw Response, returning it");
        return authError;
      }
      throw authError;
    }

    const { session } = authResult;

    if (!session) {
      console.error("[app.tsx loader] No session found!");
      throw new Response("No session found", { status: 401 });
    }

    console.log("[app.tsx loader] Auth successful:", {
      shop: session.shop,
      sessionId: session.id ? `${session.id.slice(0, 10)}...` : "none",
    });

    return {
      apiKey: process.env.SHOPIFY_API_KEY || "",
      shop: session.shop,
      host: url.searchParams.get("host") || "",
    };
  } catch (error) {
    // Check if error is a Response (redirect)
    if (error instanceof Response) {
      console.log("[app.tsx loader] Returning redirect response");
      return error;
    }

    console.error("[app.tsx loader] Auth failed:", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export default function App() {
  const { apiKey, shop, host } = useLoaderData<typeof loader>();

  console.log("[App Component] Rendering:", {
    apiKey: apiKey ? "present" : "missing",
    shop,
    host: host ? "present" : "missing"
  });

  if (!apiKey) {
    console.error("[App Component] No API key!");
    return <div>Error: API key not configured</div>;
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
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
