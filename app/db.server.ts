import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

console.log("[db.server] Initializing Prisma client:", {
  hasDbUrl: !!process.env.DATABASE_URL,
  dbHost: process.env.DATABASE_URL?.match(/@([^:]+):/)?.[1] || "unknown",
  nodeEnv: process.env.NODE_ENV,
  hasExistingGlobal: !!global.prismaGlobal,
});

// Create a singleton PrismaClient that works in both dev and serverless production
// In serverless, this prevents creating multiple connections on each request
const prisma = global.prismaGlobal ?? new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

// Store on global to reuse across hot reloads in dev and warm starts in serverless
global.prismaGlobal = prisma;

export default prisma;
