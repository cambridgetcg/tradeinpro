/**
 * Arbitrage Feedback Component
 *
 * UI for collecting user feedback on arbitrage opportunities
 * Used to improve the ML model through active learning
 */

import { useState, useCallback } from "react";
import {
  Card,
  Text,
  Badge,
  Button,
  ButtonGroup,
  Box,
  InlineStack,
  BlockStack,
  Divider,
  TextField,
  Banner,
  Spinner,
} from "@shopify/polaris";

// =============================================================================
// TYPES
// =============================================================================

export interface ArbitrageOpportunity {
  id: number;
  cardId: string;
  buyMarket: string;
  buyPrice: number;
  buyCurrency: string;
  buyPriceGbp: number;
  sellMarket: string;
  sellPrice: number;
  sellCurrency: string;
  sellPriceGbp: number;
  grossSpread: number;
  netSpread: number;
  confidence: number;
  urgency: "immediate" | "short" | "medium" | "low";
  detectedAt: string;
  wasExecuted?: boolean | null;
  wasSuccessful?: boolean | null;
}

export interface FeedbackSubmission {
  opportunityId: number;
  wasExecuted: boolean;
  actualProfit?: number;
  wasSuccessful?: boolean;
  executionNotes?: string;
  failureReason?: string;
}

interface ArbitrageFeedbackProps {
  opportunity: ArbitrageOpportunity;
  onSubmit: (feedback: FeedbackSubmission) => Promise<void>;
  onSkip?: () => void;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    GBP: "£",
    USD: "$",
    EUR: "€",
    JPY: "¥",
  };
  return `${symbols[currency] || ""}${amount.toFixed(2)}`;
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function getUrgencyBadge(urgency: string) {
  const tones: Record<string, "success" | "warning" | "critical" | "info"> = {
    immediate: "critical",
    short: "warning",
    medium: "info",
    low: "success",
  };
  return (
    <Badge tone={tones[urgency] || "info"}>
      {urgency.charAt(0).toUpperCase() + urgency.slice(1)}
    </Badge>
  );
}

function getConfidenceBadge(confidence: number) {
  if (confidence >= 0.8) return <Badge tone="success">High Confidence</Badge>;
  if (confidence >= 0.6) return <Badge tone="warning">Medium Confidence</Badge>;
  return <Badge tone="critical">Low Confidence</Badge>;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ArbitrageFeedbackCard({
  opportunity,
  onSubmit,
  onSkip,
}: ArbitrageFeedbackProps) {
  const [feedbackState, setFeedbackState] = useState<
    "pending" | "executed" | "not_executed" | "submitting" | "submitted"
  >(opportunity.wasExecuted === null ? "pending" : "submitted");

  const [wasSuccessful, setWasSuccessful] = useState<boolean | null>(null);
  const [actualProfit, setActualProfit] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setFeedbackState("submitting");
    setError(null);

    try {
      await onSubmit({
        opportunityId: opportunity.id,
        wasExecuted: feedbackState === "executed",
        wasSuccessful: wasSuccessful ?? undefined,
        actualProfit: actualProfit ? parseFloat(actualProfit) : undefined,
        executionNotes: feedbackState === "executed" ? notes : undefined,
        failureReason: feedbackState === "not_executed" ? notes : undefined,
      });
      setFeedbackState("submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feedback");
      setFeedbackState(feedbackState === "executed" ? "executed" : "not_executed");
    }
  }, [opportunity.id, feedbackState, wasSuccessful, actualProfit, notes, onSubmit]);

  // Already has feedback
  if (opportunity.wasExecuted !== null) {
    return (
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between">
            <Text variant="headingMd" as="h3">
              {opportunity.cardId}
            </Text>
            <Badge tone={opportunity.wasSuccessful ? "success" : "critical"}>
              {opportunity.wasSuccessful ? "Successful" : "Unsuccessful"}
            </Badge>
          </InlineStack>
          <Text as="p" tone="subdued">
            Feedback already recorded
          </Text>
        </BlockStack>
      </Card>
    );
  }

  // Submitted state
  if (feedbackState === "submitted") {
    return (
      <Card>
        <Banner tone="success">
          <Text as="p">Thank you! Your feedback has been recorded.</Text>
        </Banner>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header */}
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h3">
              {opportunity.cardId}
            </Text>
            <Text as="p" tone="subdued">
              Detected {new Date(opportunity.detectedAt).toLocaleDateString()}
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            {getUrgencyBadge(opportunity.urgency)}
            {getConfidenceBadge(opportunity.confidence)}
          </InlineStack>
        </InlineStack>

        <Divider />

        {/* Opportunity Details */}
        <InlineStack gap="400" align="space-between">
          <BlockStack gap="100">
            <Text as="p" fontWeight="semibold">
              Buy from {opportunity.buyMarket}
            </Text>
            <Text as="p" variant="headingLg">
              {formatCurrency(opportunity.buyPrice, opportunity.buyCurrency)}
            </Text>
            <Text as="p" tone="subdued">
              ({formatCurrency(opportunity.buyPriceGbp, "GBP")})
            </Text>
          </BlockStack>

          <Box>
            <Text as="p" alignment="center">
              →
            </Text>
          </Box>

          <BlockStack gap="100">
            <Text as="p" fontWeight="semibold">
              Sell on {opportunity.sellMarket}
            </Text>
            <Text as="p" variant="headingLg">
              {formatCurrency(opportunity.sellPrice, opportunity.sellCurrency)}
            </Text>
            <Text as="p" tone="subdued">
              ({formatCurrency(opportunity.sellPriceGbp, "GBP")})
            </Text>
          </BlockStack>
        </InlineStack>

        {/* Spread Info */}
        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <InlineStack gap="400" align="space-between">
            <BlockStack gap="100">
              <Text as="p" tone="subdued">
                Gross Spread
              </Text>
              <Text as="p" fontWeight="semibold">
                {formatPercentage(opportunity.grossSpread)}
              </Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="p" tone="subdued">
                Net Spread
              </Text>
              <Text as="p" fontWeight="semibold" tone="success">
                {formatPercentage(opportunity.netSpread)}
              </Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="p" tone="subdued">
                Est. Profit
              </Text>
              <Text as="p" fontWeight="semibold" tone="success">
                {formatCurrency(
                  opportunity.sellPriceGbp -
                    opportunity.buyPriceGbp -
                    opportunity.sellPriceGbp * 0.15,
                  "GBP"
                )}
              </Text>
            </BlockStack>
          </InlineStack>
        </Box>

        <Divider />

        {/* Feedback Section */}
        {feedbackState === "pending" && (
          <BlockStack gap="300">
            <Text as="p" fontWeight="semibold">
              Did you execute this trade?
            </Text>
            <ButtonGroup>
              <Button onClick={() => setFeedbackState("executed")}>
                Yes, I traded
              </Button>
              <Button onClick={() => setFeedbackState("not_executed")}>
                No, I didn't trade
              </Button>
              {onSkip && (
                <Button variant="plain" onClick={onSkip}>
                  Skip
                </Button>
              )}
            </ButtonGroup>
          </BlockStack>
        )}

        {feedbackState === "executed" && (
          <BlockStack gap="400">
            <Text as="p" fontWeight="semibold">
              How did the trade go?
            </Text>
            <ButtonGroup>
              <Button
                pressed={wasSuccessful === true}
                onClick={() => setWasSuccessful(true)}
              >
                Profitable
              </Button>
              <Button
                pressed={wasSuccessful === false}
                onClick={() => setWasSuccessful(false)}
              >
                Not Profitable
              </Button>
            </ButtonGroup>

            <TextField
              label="Actual profit (GBP)"
              type="number"
              value={actualProfit}
              onChange={setActualProfit}
              autoComplete="off"
              helpText="Enter your actual profit/loss after all fees"
            />

            <TextField
              label="Notes (optional)"
              value={notes}
              onChange={setNotes}
              multiline={2}
              autoComplete="off"
              helpText="Any observations about the trade"
            />

            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={handleSubmit}
                loading={feedbackState === "submitting"}
                disabled={wasSuccessful === null}
              >
                Submit Feedback
              </Button>
              <Button variant="plain" onClick={() => setFeedbackState("pending")}>
                Back
              </Button>
            </InlineStack>
          </BlockStack>
        )}

        {feedbackState === "not_executed" && (
          <BlockStack gap="400">
            <Text as="p" fontWeight="semibold">
              Why didn't you execute?
            </Text>
            <TextField
              label="Reason (optional)"
              value={notes}
              onChange={setNotes}
              multiline={2}
              autoComplete="off"
              helpText="e.g., Card sold out, price changed, too risky"
            />

            <InlineStack gap="200">
              <Button variant="primary" onClick={handleSubmit}>
                Submit Feedback
              </Button>
              <Button variant="plain" onClick={() => setFeedbackState("pending")}>
                Back
              </Button>
            </InlineStack>
          </BlockStack>
        )}

        {feedbackState === "submitting" && (
          <InlineStack align="center" gap="200">
            <Spinner size="small" />
            <Text as="p">Submitting feedback...</Text>
          </InlineStack>
        )}

        {error && (
          <Banner tone="critical">
            <Text as="p">{error}</Text>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

// =============================================================================
// FEEDBACK LIST COMPONENT
// =============================================================================

interface ArbitrageFeedbackListProps {
  opportunities: ArbitrageOpportunity[];
  onSubmitFeedback: (feedback: FeedbackSubmission) => Promise<void>;
}

export function ArbitrageFeedbackList({
  opportunities,
  onSubmitFeedback,
}: ArbitrageFeedbackListProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const pendingOpportunities = opportunities.filter(
    (opp) => opp.wasExecuted === null
  );

  if (pendingOpportunities.length === 0) {
    return (
      <Card>
        <Banner tone="success">
          <Text as="p">All feedback has been recorded. Thank you!</Text>
        </Banner>
      </Card>
    );
  }

  const handleSkip = () => {
    if (currentIndex < pendingOpportunities.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleSubmit = async (feedback: FeedbackSubmission) => {
    await onSubmitFeedback(feedback);
    if (currentIndex < pendingOpportunities.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between">
        <Text as="p" tone="subdued">
          Opportunity {currentIndex + 1} of {pendingOpportunities.length}
        </Text>
        <Badge>{pendingOpportunities.length} pending feedback</Badge>
      </InlineStack>

      <ArbitrageFeedbackCard
        opportunity={pendingOpportunities[currentIndex]}
        onSubmit={handleSubmit}
        onSkip={handleSkip}
      />
    </BlockStack>
  );
}

export default ArbitrageFeedbackCard;
