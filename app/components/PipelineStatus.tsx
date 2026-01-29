import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Box,
  Divider,
  SkeletonBodyText,
} from "@shopify/polaris";
import { useEffect, useState, useCallback } from "react";

interface CheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  lastUpdated: string | null;
  ageHours: number | null;
  threshold: number;
  message: string;
}

interface PipelineHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: {
    s3DailyPrices: CheckResult;
    s3Pricefeed: CheckResult;
    dbPriceHistory: CheckResult;
    dbCardPrices: CheckResult;
  };
  summary: {
    healthyCount: number;
    degradedCount: number;
    unhealthyCount: number;
  };
}

interface PipelineStatusProps {
  initialData?: PipelineHealthResponse | null;
  autoRefreshMinutes?: number;
}

export function PipelineStatus({
  initialData = null,
  autoRefreshMinutes = 5,
}: PipelineStatusProps) {
  const [data, setData] = useState<PipelineHealthResponse | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(
    initialData ? new Date() : null
  );

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/health/pipeline");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const healthData: PipelineHealthResponse = await response.json();
      setData(healthData);
      setLastChecked(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData) {
      fetchHealth();
    }

    const interval = setInterval(fetchHealth, autoRefreshMinutes * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchHealth, initialData, autoRefreshMinutes]);

  const getStatusBadge = (status: "healthy" | "degraded" | "unhealthy") => {
    const toneMap = {
      healthy: "success" as const,
      degraded: "warning" as const,
      unhealthy: "critical" as const,
    };
    const labelMap = {
      healthy: "Healthy",
      degraded: "Degraded",
      unhealthy: "Unhealthy",
    };
    return <Badge tone={toneMap[status]}>{labelMap[status]}</Badge>;
  };

  const formatTimeAgo = (isoString: string | null): string => {
    if (!isoString) return "Never";
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  const getStatusIndicator = (status: "healthy" | "degraded" | "unhealthy") => {
    const colors = {
      healthy: "#2E7D32",
      degraded: "#F9A825",
      unhealthy: "#C62828",
    };
    return (
      <span
        style={{
          display: "inline-block",
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: colors[status],
          marginRight: "8px",
        }}
      />
    );
  };

  const checkLabels: Record<string, string> = {
    s3DailyPrices: "S3 Daily Prices",
    s3Pricefeed: "S3 Pricefeed",
    dbPriceHistory: "DB Price History",
    dbCardPrices: "DB Card Prices",
  };

  if (loading && !data) {
    return (
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text as="h2" variant="headingMd">
              Data Pipeline Health
            </Text>
          </InlineStack>
          <SkeletonBodyText lines={4} />
        </BlockStack>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text as="h2" variant="headingMd">
              Data Pipeline Health
            </Text>
            <Badge tone="critical">Error</Badge>
          </InlineStack>
          <Text as="p" tone="critical">
            Failed to load pipeline status: {error}
          </Text>
          <Button onClick={fetchHealth}>Retry</Button>
        </BlockStack>
      </Card>
    );
  }

  if (!data) return null;

  const overallMessage =
    data.status === "healthy"
      ? "All systems operational"
      : data.status === "degraded"
        ? `${data.summary.degradedCount} source${data.summary.degradedCount > 1 ? "s" : ""} degraded`
        : `${data.summary.unhealthyCount} source${data.summary.unhealthyCount > 1 ? "s" : ""} unhealthy`;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Data Pipeline Health
            </Text>
            {getStatusBadge(data.status)}
          </InlineStack>
          <Button
            variant="plain"
            onClick={fetchHealth}
            loading={loading}
            accessibilityLabel="Refresh pipeline status"
          >
            Refresh
          </Button>
        </InlineStack>

        <BlockStack gap="300">
          {Object.entries(data.checks).map(([key, check]) => (
            <InlineStack key={key} align="space-between" blockAlign="center">
              <InlineStack gap="100" blockAlign="center">
                {getStatusIndicator(check.status)}
                <Text as="span" variant="bodyMd">
                  {checkLabels[key] || key}
                </Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  {formatTimeAgo(check.lastUpdated)}
                </Text>
              </InlineStack>
            </InlineStack>
          ))}
        </BlockStack>

        <Divider />

        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" variant="bodySm" tone="subdued">
            {overallMessage}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Checked {lastChecked ? formatTimeAgo(lastChecked.toISOString()) : "never"}
          </Text>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
