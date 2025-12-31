/**
 * useSessionToken Hook
 *
 * React hook for managing Shopify session tokens with auto-refresh.
 * Tokens expire in 5 minutes, so we refresh every 4 minutes to prevent expiration.
 *
 * @see https://shopify.dev/docs/api/customer-account-ui-extensions/apis/session-token
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { CONFIG } from '../config';
import {
  decodeSessionToken,
  isTokenExpired,
  isPreviewMode,
  type DecodedSessionToken,
} from '../utils/sessionToken';

export interface UseSessionTokenResult {
  /** Current session token (or null if not available) */
  token: string | null;
  /** Decoded token data with claims */
  decoded: DecodedSessionToken | null;
  /** Whether the token is currently being fetched */
  loading: boolean;
  /** Error message if token fetch failed */
  error: string | null;
  /** Whether we're in preview mode (theme editor) */
  isPreview: boolean;
  /** Whether the customer is authenticated */
  isAuthenticated: boolean;
  /** Manually refresh the token */
  refresh: () => Promise<void>;
}

/**
 * Hook for managing Shopify session tokens with auto-refresh
 */
export function useSessionToken(): UseSessionTokenResult {
  const [token, setToken] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<DecodedSessionToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetch a new session token from Shopify
   */
  const fetchToken = useCallback(async () => {
    console.log('[useSessionToken] Fetching token...');

    try {
      // The global 'shopify' object is injected by the extension runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shopifyGlobal = typeof (globalThis as any).shopify !== 'undefined' ? (globalThis as any).shopify : null;

      if (!shopifyGlobal) {
        console.error('[useSessionToken] shopify global is undefined');
        setError('Shopify session token API not available');
        setLoading(false);
        return;
      }

      if (!shopifyGlobal.sessionToken) {
        console.error('[useSessionToken] shopify.sessionToken is undefined');
        setError('Shopify session token API not available');
        setLoading(false);
        return;
      }

      console.log('[useSessionToken] Calling shopify.sessionToken.get()...');
      const newToken = await shopifyGlobal.sessionToken.get();
      console.log('[useSessionToken] Token received:', newToken ? `${newToken.substring(0, 50)}...` : 'null');

      if (!newToken) {
        console.error('[useSessionToken] No token returned from sessionToken.get()');
        setError('No session token returned');
        setToken(null);
        setDecoded(null);
        setLoading(false);
        return;
      }

      // Check for preview mode (theme editor)
      if (isPreviewMode(newToken)) {
        console.log('[useSessionToken] Preview mode detected');
        setIsPreview(true);
        setToken(newToken);
        setDecoded(null);
        setError(null);
        setLoading(false);
        return;
      }

      // Decode and validate token
      const decodedToken = decodeSessionToken(newToken);
      console.log('[useSessionToken] Decoded token:', decodedToken ? {
        customerId: decodedToken.customerId,
        shop: decodedToken.shop,
        isExpired: decodedToken.isExpired,
        aud: decodedToken.claims.aud,
        sub: decodedToken.claims.sub,
      } : 'null');

      if (!decodedToken) {
        console.error('[useSessionToken] Failed to decode token');
        setError('Failed to decode session token');
        setToken(null);
        setDecoded(null);
        setLoading(false);
        return;
      }

      if (decodedToken.isExpired) {
        console.error('[useSessionToken] Token is expired');
        setError('Session token expired');
        setToken(null);
        setDecoded(null);
        setLoading(false);
        return;
      }

      setToken(newToken);
      setDecoded(decodedToken);
      setError(null);
      setIsPreview(false);

      console.log('[useSessionToken] Token set successfully', {
        customerId: decodedToken.customerId,
        shop: decodedToken.shop,
        expiresIn: `${Math.round((decodedToken.claims.exp - Date.now() / 1000) / 60)} min`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get session token';
      console.error('[useSessionToken] Error fetching token:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Set up auto-refresh interval
   */
  useEffect(() => {
    // Initial token fetch
    fetchToken();

    // Set up auto-refresh every 4 minutes (before 5-minute expiry)
    refreshIntervalRef.current = setInterval(
      fetchToken,
      CONFIG.TOKEN_REFRESH_INTERVAL
    );

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [fetchToken]);

  /**
   * Check token validity and refresh if needed
   */
  useEffect(() => {
    if (token && isTokenExpired(token)) {
      if (CONFIG.DEBUG_MODE) {
        console.log('[useSessionToken] Token expired, refreshing...');
      }
      fetchToken();
    }
  }, [token, fetchToken]);

  return {
    token,
    decoded,
    loading,
    error,
    isPreview,
    isAuthenticated: !!(decoded?.customerId),
    refresh: fetchToken,
  };
}

export default useSessionToken;
