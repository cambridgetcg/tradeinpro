import {
  reactExtension,
  Page,
  BlockStack,
  InlineStack,
  Button,
  Text,
  Spinner,
  Banner,
} from '@shopify/ui-extensions-react/customer-account';
import { useState, useEffect, useCallback } from 'react';
import { StatsBar } from './components/StatsBar';
import { FilterTabs } from './components/FilterTabs';
import { SubmissionList } from './components/SubmissionList';
import { SubmissionDetail } from './components/SubmissionDetail';
import { EmptyState } from './components/EmptyState';
import { fetchSubmissions } from './api/client';
import { useSessionToken } from './hooks/useSessionToken';
import type { SubmissionSummary, CustomerStats, FilterTab } from './types';

export default reactExtension(
  'customer-account.page.render',
  () => <TradeInPage />
);

function TradeInPage() {
  // Session token with auto-refresh
  const { token, decoded, loading: tokenLoading, error: tokenError, isPreview, isAuthenticated } = useSessionToken();

  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [selectedSubmission, setSelectedSubmission] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // Get shop domain from decoded token
  const shopDomain = decoded?.shop || '';

  const loadSubmissions = useCallback(async (filter: FilterTab, pageNum: number) => {
    // Don't load if we don't have a token or shop domain yet
    if (!token || !shopDomain) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const statusMap: Record<FilterTab, string | undefined> = {
        all: undefined,
        active: 'pending',
        completed: 'completed',
        needs_action: 'PENDING_APPROVAL',
      };
      const data = await fetchSubmissions(token, shopDomain, {
        page: pageNum,
        limit: 20,
        status: statusMap[filter],
      });
      setSubmissions(
        pageNum === 1 ? data.submissions : [...submissions, ...data.submissions]
      );
      setStats(data.stats);
      setHasMore(data.pagination.hasMore);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load submissions';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, shopDomain, submissions]);

  // Load submissions when token becomes available or filter changes
  useEffect(() => {
    if (token && shopDomain && !isPreview) {
      loadSubmissions(activeFilter, 1);
    }
  }, [activeFilter, token, shopDomain, isPreview]);

  const handleFilterChange = (filter: FilterTab) => {
    setActiveFilter(filter);
    setPage(1);
  };

  const handleBack = () => {
    setSelectedSubmission(null);
    loadSubmissions(activeFilter, 1);
  };

  // Preview mode (theme editor) - show friendly message
  if (isPreview) {
    return (
      <Page title="My Trade-Ins">
        <BlockStack spacing="loose">
          <Banner status="info">
            <Text>Log in to view your trade-in submissions.</Text>
          </Banner>
          <EmptyState filter="all" />
        </BlockStack>
      </Page>
    );
  }

  // Token loading state
  if (tokenLoading) {
    return (
      <Page title="My Trade-Ins">
        <BlockStack inlineAlignment="center" padding="loose">
          <Spinner />
          <Text>Authenticating...</Text>
        </BlockStack>
      </Page>
    );
  }

  // Token error
  if (tokenError) {
    return (
      <Page title="My Trade-Ins">
        <BlockStack spacing="loose">
          <Banner status="critical">
            <Text>Authentication failed. Please refresh the page.</Text>
          </Banner>
        </BlockStack>
      </Page>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <Page title="My Trade-Ins">
        <BlockStack spacing="loose">
          <Banner status="warning">
            <Text>Please log in to view your trade-in submissions.</Text>
          </Banner>
          <EmptyState filter="all" />
        </BlockStack>
      </Page>
    );
  }

  // Submission detail view
  if (selectedSubmission) {
    return (
      <SubmissionDetail
        submissionNumber={selectedSubmission}
        onBack={handleBack}
        token={token}
        shopDomain={shopDomain}
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
          <Banner status="critical">
            <Text>{error}</Text>
          </Banner>
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
