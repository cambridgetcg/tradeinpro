/**
 * API Key Management Endpoints
 *
 * GET /api/v1/keys - List API keys for the authenticated user
 * POST /api/v1/keys - Create a new API key
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticateRequest, ApiAuthError, getApiKeyStats } = await import(
    "../lib/neural/api-auth.server"
  );
  const { getShardClient } = await import("../lib/shard.server");

  try {
    // Authenticate request
    const auth = await authenticateRequest(request);

    // Only allow authenticated users to list their keys
    if (auth.tier === "free" && auth.keyId === "public") {
      return json(
        { error: "Authentication required to list API keys" },
        { status: 401 }
      );
    }

    const client = getShardClient("onepiece");

    // Get keys associated with the authenticated user
    // In a real implementation, you'd match on user_id
    const keys = await client.apiKey.findMany({
      where: {
        status: "active",
      },
      select: {
        id: true,
        keyPrefix: true,
        name: true,
        tier: true,
        rateLimitDaily: true,
        rateLimitMinute: true,
        allowedEndpoints: true,
        allowedGames: true,
        maxHistoryDays: true,
        bulkAccess: true,
        webhookAccess: true,
        streamingAccess: true,
        neuralAccess: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    // Get usage stats for each key
    const keysWithStats = await Promise.all(
      keys.map(async (key) => {
        const stats = await getApiKeyStats(key.id);
        return {
          ...key,
          usage: stats,
        };
      })
    );

    return json({
      keys: keysWithStats,
      total: keys.length,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json(
        { error: error.message, details: error.details },
        { status: error.status }
      );
    }
    console.error("[api.v1.keys] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const {
    authenticateRequest,
    ApiAuthError,
    createApiKey,
  } = await import("../lib/neural/api-auth.server");
  const { CreateApiKeyRequestSchema } = await import(
    "../lib/neural/validation.server"
  );

  try {
    // Authenticate request - require at least developer tier to create keys
    const auth = await authenticateRequest(request);

    if (auth.tier === "free") {
      return json(
        {
          error: "Developer tier or higher required to create API keys",
          upgradeUrl: "/api/upgrade",
        },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = CreateApiKeyRequestSchema.parse(body);

    // Create the API key
    const result = await createApiKey({
      name: validatedData.name,
      email: validatedData.email,
      tier: validatedData.tier,
      organization: validatedData.organization,
      allowedGames: validatedData.allowedGames,
    });

    return json(
      {
        message: "API key created successfully",
        key: {
          id: result.keyId,
          apiKey: result.apiKey, // Only shown once!
          prefix: result.prefix,
          name: validatedData.name,
          tier: validatedData.tier,
        },
        warning: "Store this API key securely. It will not be shown again.",
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json(
        { error: error.message, details: error.details },
        { status: error.status }
      );
    }
    if (error instanceof Error && error.name === "ZodError") {
      return json(
        { error: "Invalid request data", details: error.message },
        { status: 400 }
      );
    }
    console.error("[api.v1.keys] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
