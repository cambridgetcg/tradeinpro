import {
  reactExtension,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Link,
  Spinner,
} from '@shopify/ui-extensions-react/customer-account';
import { useState, useEffect } from 'react';
import { fetchSubmissions } from './api/client';
import { useSessionToken } from './hooks/useSessionToken';
import type { CustomerStats } from './types';

export default reactExtension(
  'customer-account.profile.block.render',
  () => <ProfileWidget />
);

function ProfileWidget() {
  const { token, decoded, loading: tokenLoading, isPreview } = useSessionToken();
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [loading, setLoading] = useState(true);

  const shopDomain = decoded?.shop || '';

  useEffect(() => {
    if (!token || !shopDomain || isPreview) {
      setLoading(false);
      return;
    }

    fetchSubmissions(token, shopDomain, { limit: 1 })
      .then((data) => setStats(data.stats))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, shopDomain, isPreview]);

  const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;

  if (loading || tokenLoading) {
    return (
      <Card title="Trade-In Activity">
        <BlockStack inlineAlignment="center" padding="base">
          <Spinner size="small" />
        </BlockStack>
      </Card>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <Card title="Trade-In Activity">
        <BlockStack spacing="tight">
          <Text appearance="subdued">No trade-ins yet</Text>
          <Link to="/pages/trade-in">Start your first trade-in</Link>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card title="Trade-In Activity">
      <BlockStack spacing="base">
        <InlineStack spacing="loose">
          <BlockStack spacing="none">
            <Text emphasis="bold" size="large">
              {stats.total}
            </Text>
            <Text size="small" appearance="subdued">
              Trade-ins
            </Text>
          </BlockStack>
          <BlockStack spacing="none">
            <Text emphasis="bold" size="large">
              {stats.pending}
            </Text>
            <Text size="small" appearance="subdued">
              In Progress
            </Text>
          </BlockStack>
          <BlockStack spacing="none">
            <Text emphasis="bold" size="large" appearance="success">
              {formatCurrency(stats.totalEarned)}
            </Text>
            <Text size="small" appearance="subdued">
              Earned
            </Text>
          </BlockStack>
        </InlineStack>
        <Link to="/account/trade-ins">View All Trade-Ins →</Link>
      </BlockStack>
    </Card>
  );
}
