/**
 * Individual API Key Management
 *
 * GET /api/v1/keys/:keyId - Get key details and usage
 * PATCH /api/v1/keys/:keyId - Update key settings
 * DELETE /api/v1/keys/:keyId - Revoke key
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const {
    authenticateRequest,
    ApiAuthError,
    getApiKeyStats,
  } = await import("../lib/neural/api-auth.server");
  const { getShardClient } = await import("../lib/shard.server");

  const { keyId } = params;
  if (!keyId) {
    return json({ error: "Key ID is required" }, { status: 400 });
  }

  try {
    // Authenticate request
    const auth = await authenticateRequest(request);

    if (auth.tier === "free" && auth.keyId === "public") {
      return json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const client = getShardClient("onepiece");

    // Get key details
    const key = await client.apiKey.findUnique({
      where: { id: keyId },
      select: {
        id: true,
        keyPrefix: true,
        name: true,
        email: true,
        organization: true,
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
        status: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });

    if (!key) {
      return json({ error: "API key not found" }, { status: 404 });
    }

    // Get usage stats
    const stats = await getApiKeyStats(keyId);

    // Get recent usage history
    const recentUsage = await client.apiUsage.findMany({
      where: { apiKeyId: keyId },
      orderBy: { requestTimestamp: "desc" },
      take: 100,
      select: {
        endpoint: true,
        method: true,
        statusCode: true,
        responseTimeMs: true,
        billableUnits: true,
        requestTimestamp: true,
      },
    });

    return json({
      key,
      stats,
      recentUsage,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json(
        { error: error.message, details: error.details },
        { status: error.status }
      );
    }
    console.error("[api.v1.keys.$keyId] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const {
    authenticateRequest,
    ApiAuthError,
    revokeApiKey,
    updateApiKeyTier,
  } = await import("../lib/neural/api-auth.server");
  const { UpdateApiKeyRequestSchema } = await import(
    "../lib/neural/validation.server"
  );
  const { getShardClient } = await import("../lib/shard.server");

  const { keyId } = params;
  if (!keyId) {
    return json({ error: "Key ID is required" }, { status: 400 });
  }

  try {
    // Authenticate request
    const auth = await authenticateRequest(request);

    // Require at least developer tier for key management
    if (auth.tier === "free") {
      return json(
        { error: "Developer tier or higher required for key management" },
        { status: 403 }
      );
    }

    const client = getShardClient("onepiece");

    // Check key exists
    const existingKey = await client.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!existingKey) {
      return json({ error: "API key not found" }, { status: 404 });
    }

    // Handle DELETE - revoke key
    if (request.method === "DELETE") {
      await revokeApiKey(keyId);
      return json({
        message: "API key revoked successfully",
        keyId,
      });
    }

    // Handle PATCH - update key
    if (request.method === "PATCH") {
      const body = await request.json();
      const validatedData = UpdateApiKeyRequestSchema.parse(body);

      const updates: Record<string, unknown> = {};

      if (validatedData.name) {
        updates.name = validatedData.name;
      }

      if (validatedData.tier) {
        // Use the updateApiKeyTier function for tier changes
        await updateApiKeyTier(keyId, validatedData.tier);
      }

      if (validatedData.status) {
        updates.status = validatedData.status;
      }

      if (validatedData.allowedEndpoints) {
        updates.allowedEndpoints = validatedData.allowedEndpoints;
      }

      if (validatedData.allowedGames) {
        updates.allowedGames = validatedData.allowedGames;
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await client.apiKey.update({
          where: { id: keyId },
          data: updates,
        });
      }

      // Fetch updated key
      const updatedKey = await client.apiKey.findUnique({
        where: { id: keyId },
        select: {
          id: true,
          keyPrefix: true,
          name: true,
          tier: true,
          status: true,
          allowedEndpoints: true,
          allowedGames: true,
        },
      });

      return json({
        message: "API key updated successfully",
        key: updatedKey,
      });
    }

    return json({ error: "Method not allowed" }, { status: 405 });
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
    console.error("[api.v1.keys.$keyId] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
