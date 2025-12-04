import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// Log configuration on startup
console.log("[CARDFORUM] Initializing Shopify app...");
console.log("[CARDFORUM] SHOPIFY_API_KEY:", process.env.SHOPIFY_API_KEY ? "✓ Set" : "✗ Missing");
console.log("[CARDFORUM] SHOPIFY_API_SECRET:", process.env.SHOPIFY_API_SECRET ? "✓ Set" : "✗ Missing");
console.log("[CARDFORUM] SHOPIFY_APP_URL:", process.env.SHOPIFY_APP_URL || "✗ Missing");
console.log("[CARDFORUM] SCOPES:", process.env.SCOPES || "✗ Missing");
console.log("[CARDFORUM] DATABASE_URL:", process.env.DATABASE_URL ? "✓ Set" : "✗ Missing");

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

console.log("[CARDFORUM] Shopify app initialized successfully");

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
