import {
  reactExtension,
  Page,
  BlockStack,
  InlineStack,
  Button,
  Text,
  Spinner,
} from '@shopify/ui-extensions-react/customer-account';
import { useState, useEffect } from 'react';
import { StatsBar } from './components/StatsBar';
import { FilterTabs } from './components/FilterTabs';
import { SubmissionList } from './components/SubmissionList';
import { SubmissionDetail } from './components/SubmissionDetail';
import { EmptyState } from './components/EmptyState';
import { fetchSubmissions } from './api/client';
import type { SubmissionSummary, CustomerStats, FilterTab } from './types';

export default reactExtension(
  'customer-account.page.render',
  () => <TradeInPage />
);

function TradeInPage() {
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [selectedSubmission, setSelectedSubmission] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const loadSubmissions = async (filter: FilterTab, pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const statusMap: Record<FilterTab, string | undefined> = {
        all: undefined,
        active: 'pending',
        completed: 'completed',
        needs_action: 'PENDING_APPROVAL',
      };
      const data = await fetchSubmissions({
        page: pageNum,
        limit: 20,
        status: statusMap[filter],
      });
      setSubmissions(
        pageNum === 1 ? data.submissions : [...submissions, ...data.submissions]
      );
      setStats(data.stats);
      setHasMore(data.pagination.hasMore);
    } catch {
      setError('Failed to load submissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubmissions(activeFilter, 1);
  }, [activeFilter]);

  const handleFilterChange = (filter: FilterTab) => {
    setActiveFilter(filter);
    setPage(1);
  };

  const handleBack = () => {
    setSelectedSubmission(null);
    loadSubmissions(activeFilter, 1);
  };

  if (selectedSubmission) {
    return (
      <SubmissionDetail
        submissionNumber={selectedSubmission}
        onBack={handleBack}
      />
    );
  }

  const needsActionCount = submissions.filter((s) => s.needsReview).length;

  return (
    <Page title="My Trade-Ins">
      <BlockStack spacing="loose">
        <InlineStack blockAlignment="center" inlineAlignment="end">
          <Button to="/pages/trade-in">Start New Trade-In</Button>
        </InlineStack>

        {stats && <StatsBar stats={stats} />}

        <FilterTabs
          active={activeFilter}
          onChange={handleFilterChange}
          counts={{
            all: stats?.total || 0,
            active: stats?.pending || 0,
            completed: stats?.completed || 0,
            needs_action: needsActionCount,
          }}
        />

        {loading && submissions.length === 0 ? (
          <BlockStack inlineAlignment="center" padding="loose">
            <Spinner />
            <Text>Loading submissions...</Text>
          </BlockStack>
        ) : error ? (
          <Text appearance="critical">{error}</Text>
        ) : submissions.length === 0 ? (
          <EmptyState filter={activeFilter} />
        ) : (
          <SubmissionList
            submissions={submissions}
            onSelect={(num) => setSelectedSubmission(num)}
            loading={loading}
            hasMore={hasMore}
            onLoadMore={() => {
              const nextPage = page + 1;
              setPage(nextPage);
              loadSubmissions(activeFilter, nextPage);
            }}
          />
        )}
      </BlockStack>
    </Page>
  );
}
