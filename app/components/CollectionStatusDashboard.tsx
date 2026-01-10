/**
 * Collection Status Dashboard Component
 *
 * Displays data collection pipeline status, job states, and training readiness
 */

import {
  Card,
  Text,
  Badge,
  Button,
  Box,
  InlineStack,
  BlockStack,
  Divider,
  ProgressBar,
  Icon,
  Spinner,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { useState, useCallback } from "react";

// =============================================================================
// TYPES
// =============================================================================

export interface JobStatus {
  id: string;
  name: string;
  enabled: boolean;
  intervalMs?: number;
  lastRun?: string;
  nextRun?: string;
  isRunning: boolean;
  consecutiveFailures: number;
  lastResult?: {
    status: "success" | "failed" | "partial";
    recordsProcessed: number;
    errorsCount: number;
    completedAt: string;
  };
}

export interface DataFreshness {
  lastUpdate: string;
  ageMinutes: number;
  isStale: boolean;
  rates?: {
    USDGBP: number;
    EURGBP: number;
    JPYGBP: number;
  };
}

export interface TrainingReadiness {
  required: number;
  collected: number;
  percentComplete: number;
  ready: boolean;
}

export interface CollectionStatus {
  jobs: JobStatus[];
  dataCounts: {
    usPrices: number;
    euPrices: number;
    fxRates: number;
    arbitrageOpportunities: number;
    dailyHistory: number;
    trainingFeedback: number;
  };
  dataFreshness: {
    usMarket: DataFreshness | null;
    euMarket: DataFreshness | null;
    fxRates: DataFreshness | null;
  };
  trainingReadiness: {
    arbitrage: TrainingReadiness;
    timeSeries: TrainingReadiness;
    feedback: TrainingReadiness;
  };
  timestamp: string;
}

interface CollectionStatusDashboardProps {
  status: CollectionStatus;
  onRefresh: () => Promise<void>;
  onRunJob: (jobId: string) => Promise<void>;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatInterval(ms?: number): string {
  if (!ms) return "N/A";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTimeAgo(dateStr?: string): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// =============================================================================
// JOB STATUS CARD
// =============================================================================

function JobStatusCard({
  job,
  onRun,
}: {
  job: JobStatus;
  onRun: () => void;
}) {
  const statusIcon = job.isRunning ? (
    <Spinner size="small" />
  ) : job.lastResult?.status === "success" ? (
    <Icon source={CheckCircleIcon} tone="success" />
  ) : job.lastResult?.status === "failed" ? (
    <Icon source={XCircleIcon} tone="critical" />
  ) : (
    <Icon source={ClockIcon} tone="subdued" />
  );

  const statusBadge = job.isRunning ? (
    <Badge tone="attention">Running</Badge>
  ) : job.consecutiveFailures > 0 ? (
    <Badge tone="critical">{job.consecutiveFailures} failures</Badge>
  ) : !job.enabled ? (
    <Badge>Disabled</Badge>
  ) : (
    <Badge tone="success">Ready</Badge>
  );

  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <InlineStack align="space-between" blockAlign="center">
        <InlineStack gap="200" blockAlign="center">
          {statusIcon}
          <BlockStack gap="100">
            <Text as="p" fontWeight="semibold">
              {job.name}
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Every {formatInterval(job.intervalMs)} • Last: {formatTimeAgo(job.lastRun)}
            </Text>
          </BlockStack>
        </InlineStack>
        <InlineStack gap="200">
          {statusBadge}
          <Button
            size="slim"
            disabled={job.isRunning || !job.enabled}
            onClick={onRun}
            icon={RefreshIcon}
          >
            Run
          </Button>
        </InlineStack>
      </InlineStack>
    </Box>
  );
}

// =============================================================================
// DATA FRESHNESS CARD
// =============================================================================

function DataFreshnessCard({
  label,
  freshness,
}: {
  label: string;
  freshness: DataFreshness | null;
}) {
  if (!freshness) {
    return (
      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
        <BlockStack gap="100">
          <Text as="p" fontWeight="semibold">
            {label}
          </Text>
          <Text as="p" tone="subdued">
            No data collected
          </Text>
        </BlockStack>
      </Box>
    );
  }

  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="200">
        <InlineStack align="space-between">
          <Text as="p" fontWeight="semibold">
            {label}
          </Text>
          {freshness.isStale ? (
            <Badge tone="warning">Stale</Badge>
          ) : (
            <Badge tone="success">Fresh</Badge>
          )}
        </InlineStack>
        <Text as="p" tone="subdued">
          Updated {formatTimeAgo(freshness.lastUpdate)}
        </Text>
        {freshness.rates && (
          <InlineStack gap="200">
            <Text as="p" variant="bodySm">
              USD/GBP: {freshness.rates.USDGBP.toFixed(4)}
            </Text>
            <Text as="p" variant="bodySm">
              EUR/GBP: {freshness.rates.EURGBP.toFixed(4)}
            </Text>
          </InlineStack>
        )}
      </BlockStack>
    </Box>
  );
}

// =============================================================================
// TRAINING READINESS CARD
// =============================================================================

function TrainingReadinessCard({
  label,
  readiness,
}: {
  label: string;
  readiness: TrainingReadiness;
}) {
  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="200">
        <InlineStack align="space-between">
          <Text as="p" fontWeight="semibold">
            {label}
          </Text>
          {readiness.ready ? (
            <Badge tone="success">Ready</Badge>
          ) : (
            <Badge tone="warning">{readiness.percentComplete}%</Badge>
          )}
        </InlineStack>
        <ProgressBar
          progress={readiness.percentComplete}
          tone={readiness.ready ? "success" : "primary"}
          size="small"
        />
        <Text as="p" tone="subdued" variant="bodySm">
          {formatNumber(readiness.collected)} / {formatNumber(readiness.required)} records
        </Text>
      </BlockStack>
    </Box>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function CollectionStatusDashboard({
  status,
  onRefresh,
  onRunJob,
}: CollectionStatusDashboardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  return (
    <BlockStack gap="500">
      {/* Header */}
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text variant="headingLg" as="h2">
            Data Collection Pipeline
          </Text>
          <Text as="p" tone="subdued">
            Last updated: {formatTimeAgo(status.timestamp)}
          </Text>
        </BlockStack>
        <Button
          onClick={handleRefresh}
          loading={isRefreshing}
          icon={RefreshIcon}
        >
          Refresh
        </Button>
      </InlineStack>

      {/* Data Counts */}
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h3">
            Data Summary
          </Text>
          <InlineStack gap="400" align="space-between" wrap>
            <BlockStack gap="100" inlineAlign="center">
              <Text variant="headingXl" as="p">
                {formatNumber(status.dataCounts.usPrices)}
              </Text>
              <Text as="p" tone="subdued">
                US Prices
              </Text>
            </BlockStack>
            <BlockStack gap="100" inlineAlign="center">
              <Text variant="headingXl" as="p">
                {formatNumber(status.dataCounts.euPrices)}
              </Text>
              <Text as="p" tone="subdued">
                EU Prices
              </Text>
            </BlockStack>
            <BlockStack gap="100" inlineAlign="center">
              <Text variant="headingXl" as="p">
                {formatNumber(status.dataCounts.arbitrageOpportunities)}
              </Text>
              <Text as="p" tone="subdued">
                Opportunities
              </Text>
            </BlockStack>
            <BlockStack gap="100" inlineAlign="center">
              <Text variant="headingXl" as="p">
                {formatNumber(status.dataCounts.dailyHistory)}
              </Text>
              <Text as="p" tone="subdued">
                Daily Records
              </Text>
            </BlockStack>
            <BlockStack gap="100" inlineAlign="center">
              <Text variant="headingXl" as="p">
                {formatNumber(status.dataCounts.trainingFeedback)}
              </Text>
              <Text as="p" tone="subdued">
                Feedback
              </Text>
            </BlockStack>
          </InlineStack>
        </BlockStack>
      </Card>

      {/* Data Freshness */}
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h3">
            Data Freshness
          </Text>
          <InlineStack gap="300" wrap>
            <Box minWidth="200px">
              <DataFreshnessCard
                label="US Market"
                freshness={status.dataFreshness.usMarket}
              />
            </Box>
            <Box minWidth="200px">
              <DataFreshnessCard
                label="EU Market"
                freshness={status.dataFreshness.euMarket}
              />
            </Box>
            <Box minWidth="200px">
              <DataFreshnessCard
                label="FX Rates"
                freshness={status.dataFreshness.fxRates}
              />
            </Box>
          </InlineStack>
        </BlockStack>
      </Card>

      {/* Collection Jobs */}
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h3">
            Collection Jobs
          </Text>
          <BlockStack gap="200">
            {status.jobs.map((job) => (
              <JobStatusCard
                key={job.id}
                job={job}
                onRun={() => onRunJob(job.id)}
              />
            ))}
          </BlockStack>
        </BlockStack>
      </Card>

      {/* Training Readiness */}
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h3">
            Training Data Readiness
          </Text>
          <InlineStack gap="300" wrap>
            <Box minWidth="200px">
              <TrainingReadinessCard
                label="Arbitrage Model"
                readiness={status.trainingReadiness.arbitrage}
              />
            </Box>
            <Box minWidth="200px">
              <TrainingReadinessCard
                label="Time Series (TFT)"
                readiness={status.trainingReadiness.timeSeries}
              />
            </Box>
            <Box minWidth="200px">
              <TrainingReadinessCard
                label="User Feedback"
                readiness={status.trainingReadiness.feedback}
              />
            </Box>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

export default CollectionStatusDashboard;
