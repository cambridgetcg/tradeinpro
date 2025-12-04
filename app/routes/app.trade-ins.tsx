import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function TradeIns() {
  return (
    <div style={{ padding: "20px", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600, marginBottom: "16px" }}>
        Trade-In Submissions
      </h1>
      <p style={{ color: "#6b7280" }}>
        Manage customer trade-in submissions here.
      </p>
      <div style={{
        marginTop: "24px",
        padding: "40px",
        background: "#f9fafb",
        borderRadius: "8px",
        textAlign: "center"
      }}>
        <p style={{ color: "#9ca3af", fontSize: "14px" }}>No submissions yet</p>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
