/**
 * AWS Secrets Manager Integration
 *
 * Provides secure access to application secrets stored in AWS Secrets Manager.
 * Falls back to environment variables in development for convenience.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

// ============================================================================
// Configuration
// ============================================================================

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const USE_SECRETS_MANAGER = process.env.USE_SECRETS_MANAGER === "true";
const SECRET_PREFIX = "/cardforum/dev";

// Singleton client
let client: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
  if (!client) {
    client = new SecretsManagerClient({ region: AWS_REGION });
  }
  return client;
}

// ============================================================================
// Secret Cache
// ============================================================================

interface CachedSecret {
  value: string;
  expiresAt: number;
}

const secretCache = new Map<string, CachedSecret>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Public API
// ============================================================================

/**
 * Get a secret value from AWS Secrets Manager.
 * Falls back to environment variable if Secrets Manager is disabled.
 *
 * @param secretName - The secret name (without prefix)
 * @param envFallback - Environment variable name to use as fallback
 * @returns The secret value or undefined if not found
 */
export async function getSecret(
  secretName: string,
  envFallback?: string
): Promise<string | undefined> {
  // In development, use env vars directly
  if (!USE_SECRETS_MANAGER) {
    if (envFallback) {
      return process.env[envFallback];
    }
    // Try to derive env var name from secret name
    const envName = secretName
      .toUpperCase()
      .replace(/[/-]/g, "_")
      .replace(/^_+|_+$/g, "");
    return process.env[envName];
  }

  const fullSecretName = `${SECRET_PREFIX}/${secretName}`;

  // Check cache
  const cached = secretCache.get(fullSecretName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const command = new GetSecretValueCommand({
      SecretId: fullSecretName,
    });

    const response = await getClient().send(command);
    const value = response.SecretString;

    if (value) {
      // Cache the value
      secretCache.set(fullSecretName, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    return value || undefined;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      console.warn(`[Secrets] Secret not found: ${fullSecretName}`);
      // Fall back to env var
      if (envFallback) {
        return process.env[envFallback];
      }
    }
    console.error(`[Secrets] Error fetching secret ${fullSecretName}:`, error);
    // Fall back to env var on error
    if (envFallback) {
      return process.env[envFallback];
    }
    return undefined;
  }
}

/**
 * Get a JSON secret and parse it.
 *
 * @param secretName - The secret name (without prefix)
 * @returns Parsed JSON object or undefined
 */
export async function getJsonSecret<T = Record<string, unknown>>(
  secretName: string
): Promise<T | undefined> {
  const value = await getSecret(secretName);
  if (!value) return undefined;

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error(`[Secrets] Failed to parse JSON secret ${secretName}:`, error);
    return undefined;
  }
}

/**
 * Get database credentials from Secrets Manager.
 */
export async function getDatabaseCredentials(): Promise<{
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
} | undefined> {
  const creds = await getJsonSecret<{
    host: string;
    port: number;
    dbname: string;
    username: string;
    password: string;
  }>("database/postgres-credentials");

  if (!creds) return undefined;

  return {
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    username: creds.username,
    password: creds.password,
  };
}

/**
 * Build a database URL from Secrets Manager credentials.
 */
export async function getDatabaseUrl(): Promise<string | undefined> {
  // First try env var (for local development)
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const creds = await getDatabaseCredentials();
  if (!creds) return undefined;

  return `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.database}`;
}

/**
 * Clear the secret cache.
 * Useful for testing or when secrets are rotated.
 */
export function clearSecretCache(): void {
  secretCache.clear();
}

// ============================================================================
// Predefined Secret Accessors
// ============================================================================

export async function getShopifyApiKey(): Promise<string | undefined> {
  return getSecret("api/shopify-api-key", "SHOPIFY_API_KEY");
}

export async function getShopifyApiSecret(): Promise<string | undefined> {
  return getSecret("api/shopify-api-secret", "SHOPIFY_API_SECRET");
}

export async function getSendGridApiKey(): Promise<string | undefined> {
  return getSecret("api/sendgrid-api-key", "SENDGRID_API_KEY");
}

export async function getResendApiKey(): Promise<string | undefined> {
  return getSecret("api/resend-api-key", "RESEND_API_KEY");
}

export async function getCronSecret(): Promise<string | undefined> {
  return getSecret("internal/cron-secret", "CRON_SECRET");
}
