import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  TextField,
} from '@shopify/ui-extensions-react/customer-account';
import { useState } from 'react';
import type { GradingResults, ItemDetail } from '../types';

interface GradingReviewProps {
  gradingResults: GradingResults;
  items: ItemDetail[];
  payoutType: string;
  bonusAmount: number | null;
  totalPayout: number;
  onAccept: () => void;
  onReject: (reason?: string) => void;
  loading: boolean;
}

export function GradingReview({
  gradingResults,
  items,
  payoutType,
  bonusAmount,
  totalPayout,
  onAccept,
  onReject,
  loading,
}: GradingReviewProps) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;
  const adjustedItems = items.filter((i) => i.wasAdjusted);
  const hasAdjustments = gradingResults.adjustedItems > 0;

  return (
    <Card>
      <BlockStack spacing="base">
        <Banner status="warning">
          <Text emphasis="bold">Grading Complete - Your Review Required</Text>
        </Banner>

        {hasAdjustments && (
          <BlockStack spacing="tight">
            <Text>
              {gradingResults.adjustedItems} of {gradingResults.totalItems}{' '}
              items were adjusted during grading:
            </Text>
            {adjustedItems.map((item) => (
              <Text key={item.id} size="small">
                • {item.cardName}: {item.conditionClaimed} →{' '}
                {item.conditionActual}
                {item.adjustmentReason && ` (${item.adjustmentReason})`}
              </Text>
            ))}
          </BlockStack>
        )}

        <BlockStack spacing="tight">
          <InlineStack inlineAlignment="space-between">
            <Text>Original Quote</Text>
            <Text>{formatCurrency(gradingResults.originalTotal)}</Text>
          </InlineStack>
          {hasAdjustments && (
            <InlineStack inlineAlignment="space-between">
              <Text>Adjustment</Text>
              <Text appearance="critical">
                {formatCurrency(gradingResults.adjustmentAmount)}
              </Text>
            </InlineStack>
          )}
          {payoutType === 'STORE_CREDIT' && bonusAmount && (
            <InlineStack inlineAlignment="space-between">
              <Text>Store Credit Bonus</Text>
              <Text appearance="success">+{formatCurrency(bonusAmount)}</Text>
            </InlineStack>
          )}
          <InlineStack inlineAlignment="space-between">
            <Text emphasis="bold">Final Offer</Text>
            <Text emphasis="bold" size="large">
              {formatCurrency(totalPayout)}
            </Text>
          </InlineStack>
        </BlockStack>

        {showRejectForm ? (
          <BlockStack spacing="base">
            <TextField
              label="Reason for rejection (optional)"
              value={rejectReason}
              onChange={setRejectReason}
              multiline
            />
            <InlineStack spacing="base">
              <Button
                onPress={() => onReject(rejectReason)}
                loading={loading}
                kind="secondary"
              >
                Confirm Rejection
              </Button>
              <Button onPress={() => setShowRejectForm(false)} kind="plain">
                Cancel
              </Button>
            </InlineStack>
            <Text size="small" appearance="subdued">
              Your cards will be returned to you. Return shipping may apply.
            </Text>
          </BlockStack>
        ) : (
          <InlineStack spacing="base">
            <Button onPress={onAccept} loading={loading}>
              Accept Offer
            </Button>
            <Button onPress={() => setShowRejectForm(true)} kind="secondary">
              Request Return
            </Button>
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}
