import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Pressable,
  Icon,
} from '@shopify/ui-extensions-react/customer-account';
import type { SubmissionSummary } from '../types';

interface SubmissionCardProps {
  submission: SubmissionSummary;
  onPress: () => void;
}

export function SubmissionCard({ submission, onPress }: SubmissionCardProps) {
  const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString();

  const getStatusTone = (
    status: string
  ): 'success' | 'warning' | 'critical' | undefined => {
    if (status === 'COMPLETED') return 'success';
    if (status === 'PENDING_APPROVAL') return 'warning';
    if (status === 'CANCELLED' || status === 'RETURNED') return 'critical';
    return undefined;
  };

  return (
    <Pressable onPress={onPress}>
      <Card padding="base">
        <BlockStack spacing="tight">
          <InlineStack blockAlignment="center" inlineAlignment="space-between">
            <InlineStack spacing="tight" blockAlignment="center">
              {submission.needsReview && (
                <Icon source="warning" appearance="warning" />
              )}
              <Text emphasis="bold">{submission.submissionNumber}</Text>
            </InlineStack>
            <Badge tone={getStatusTone(submission.status)}>
              {submission.statusLabel}
            </Badge>
          </InlineStack>

          <InlineStack inlineAlignment="space-between">
            <Text size="small" appearance="subdued">
              {submission.itemCount}{' '}
              {submission.itemCount === 1 ? 'card' : 'cards'}
            </Text>
            <InlineStack spacing="tight">
              <Text>
                {submission.finalTotal
                  ? formatCurrency(submission.finalTotal)
                  : formatCurrency(submission.quotedTotal)}
              </Text>
              {submission.finalTotal &&
                submission.finalTotal !== submission.quotedTotal && (
                  <Text size="small" appearance="subdued">
                    (was {formatCurrency(submission.quotedTotal)})
                  </Text>
                )}
            </InlineStack>
          </InlineStack>

          <InlineStack inlineAlignment="space-between">
            <Text size="small" appearance="subdued">
              {submission.payoutTypeLabel}
            </Text>
            <Text size="small" appearance="subdued">
              {formatDate(submission.createdAt)}
            </Text>
          </InlineStack>

          {submission.needsReview && (
            <Text size="small" appearance="warning">
              Grading complete - please review and accept or reject
            </Text>
          )}
        </BlockStack>
      </Card>
    </Pressable>
  );
}
