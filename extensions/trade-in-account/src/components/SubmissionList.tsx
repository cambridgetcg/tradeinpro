import { BlockStack, Button } from '@shopify/ui-extensions-react/customer-account';
import { SubmissionCard } from './SubmissionCard';
import type { SubmissionSummary } from '../types';

interface SubmissionListProps {
  submissions: SubmissionSummary[];
  onSelect: (submissionNumber: string) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function SubmissionList({
  submissions,
  onSelect,
  loading,
  hasMore,
  onLoadMore,
}: SubmissionListProps) {
  return (
    <BlockStack spacing="base">
      {submissions.map((submission) => (
        <SubmissionCard
          key={submission.id}
          submission={submission}
          onPress={() => onSelect(submission.submissionNumber)}
        />
      ))}
      {hasMore && (
        <Button onPress={onLoadMore} loading={loading} kind="secondary">
          Load More
        </Button>
      )}
    </BlockStack>
  );
}
