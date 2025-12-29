import {
  Page,
  BlockStack,
  InlineStack,
  Card,
  Text,
  Badge,
  Button,
  Divider,
  Spinner,
  Banner,
} from '@shopify/ui-extensions-react/customer-account';
import { useState, useEffect } from 'react';
import { Timeline } from './Timeline';
import { GradingReview } from './GradingReview';
import { fetchSubmissionDetail, submitAction } from '../api/client';
import type { SubmissionDetailResponse, ItemDetail } from '../types';

interface SubmissionDetailProps {
  submissionNumber: string;
  onBack: () => void;
}

export function SubmissionDetail({
  submissionNumber,
  onBack,
}: SubmissionDetailProps) {
  const [data, setData] = useState<SubmissionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadDetail = async () => {
    setLoading(true);
    try {
      const result = await fetchSubmissionDetail(submissionNumber);
      setData(result);
      setError(null);
    } catch {
      setError('Failed to load submission details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [submissionNumber]);

  const handleAction = async (action: 'accept' | 'reject', reason?: string) => {
    setActionLoading(true);
    try {
      await submitAction(submissionNumber, action, { reason });
      await loadDetail();
    } catch {
      setError('Action failed. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;

  if (loading) {
    return (
      <Page
        title={submissionNumber}
        primaryAction={{ content: 'Back', onAction: onBack }}
      >
        <BlockStack inlineAlignment="center" padding="loose">
          <Spinner />
        </BlockStack>
      </Page>
    );
  }

  if (error || !data) {
    return (
      <Page
        title={submissionNumber}
        primaryAction={{ content: 'Back', onAction: onBack }}
      >
        <Banner status="critical">{error || 'Failed to load'}</Banner>
      </Page>
    );
  }

  const { submission, items, timeline, gradingResults, actions } = data;

  return (
    <Page
      title={submission.submissionNumber}
      primaryAction={{ content: 'Back', onAction: onBack }}
    >
      <BlockStack spacing="loose">
        {/* Status Banner */}
        <Card>
          <BlockStack spacing="tight">
            <InlineStack inlineAlignment="space-between" blockAlignment="center">
              <Text emphasis="bold">{submission.statusLabel}</Text>
              <Badge>
                {submission.payoutType === 'STORE_CREDIT'
                  ? 'Store Credit (+10%)'
                  : 'Bank Transfer'}
              </Badge>
            </InlineStack>
            <Text size="small" appearance="subdued">
              {submission.statusDescription}
            </Text>
          </BlockStack>
        </Card>

        {/* Timeline */}
        <Timeline steps={timeline} />

        {/* Grading Review (if pending approval) */}
        {actions.canAcceptOffer && gradingResults && (
          <GradingReview
            gradingResults={gradingResults}
            items={items}
            payoutType={submission.payoutType}
            bonusAmount={submission.bonusAmount}
            totalPayout={submission.totalPayout}
            onAccept={() => handleAction('accept')}
            onReject={(reason) => handleAction('reject', reason)}
            loading={actionLoading}
          />
        )}

        {/* Items List */}
        <Card>
          <BlockStack spacing="base">
            <Text emphasis="bold">Items ({items.length})</Text>
            <Divider />
            {items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </BlockStack>
        </Card>

        {/* Summary */}
        <Card>
          <BlockStack spacing="tight">
            <Text emphasis="bold">Summary</Text>
            <Divider />
            <InlineStack inlineAlignment="space-between">
              <Text>Original Quote</Text>
              <Text>{formatCurrency(submission.quotedTotal)}</Text>
            </InlineStack>
            {submission.finalTotal &&
              submission.finalTotal !== submission.quotedTotal && (
                <InlineStack inlineAlignment="space-between">
                  <Text>Grading Adjustment</Text>
                  <Text
                    appearance={
                      submission.finalTotal < submission.quotedTotal
                        ? 'critical'
                        : 'success'
                    }
                  >
                    {formatCurrency(
                      submission.finalTotal - submission.quotedTotal
                    )}
                  </Text>
                </InlineStack>
              )}
            {submission.bonusAmount && submission.bonusAmount > 0 && (
              <InlineStack inlineAlignment="space-between">
                <Text>Store Credit Bonus (+10%)</Text>
                <Text appearance="success">
                  +{formatCurrency(submission.bonusAmount)}
                </Text>
              </InlineStack>
            )}
            <Divider />
            <InlineStack inlineAlignment="space-between">
              <Text emphasis="bold">Total Payout</Text>
              <Text emphasis="bold" size="large">
                {formatCurrency(submission.totalPayout)}
              </Text>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Actions */}
        <InlineStack spacing="base">
          {actions.canDownloadPackingSlip && (
            <Button to={`/apps/trade-in/packing-slip/${submissionNumber}`}>
              Download Packing Slip
            </Button>
          )}
          {actions.canViewShippingInstructions && (
            <Button
              to={`/apps/trade-in/shipping-instructions/${submissionNumber}`}
              kind="secondary"
            >
              Shipping Instructions
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Page>
  );
}

function ItemRow({ item }: { item: ItemDetail }) {
  const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;

  const getStatusTone = (
    status: string
  ): 'success' | 'warning' | 'critical' | undefined => {
    if (status === 'VERIFIED') return 'success';
    if (status === 'ADJUSTED') return 'warning';
    if (status === 'REJECTED') return 'critical';
    return undefined;
  };

  return (
    <BlockStack spacing="extraTight">
      <InlineStack inlineAlignment="space-between">
        <BlockStack spacing="none">
          <Text emphasis="bold">{item.cardName}</Text>
          <Text size="small" appearance="subdued">
            {item.setName} {item.variant && `(${item.variant})`}
          </Text>
        </BlockStack>
        <BlockStack spacing="none" inlineAlignment="end">
          <Text>{formatCurrency(item.finalPrice || item.quotedPrice)}</Text>
          {item.wasAdjusted && (
            <Text size="small" appearance="critical">
              was {formatCurrency(item.quotedPrice)}
            </Text>
          )}
        </BlockStack>
      </InlineStack>
      <InlineStack spacing="tight">
        <Badge size="small">{item.conditionClaimed}</Badge>
        {item.wasAdjusted && (
          <>
            <Text size="small">→</Text>
            <Badge size="small" tone="warning">
              {item.conditionActual}
            </Badge>
          </>
        )}
        <Badge size="small" tone={getStatusTone(item.status)}>
          {item.statusLabel}
        </Badge>
      </InlineStack>
      {item.adjustmentReason && (
        <Text size="small" appearance="subdued">
          Note: {item.adjustmentReason}
        </Text>
      )}
    </BlockStack>
  );
}
