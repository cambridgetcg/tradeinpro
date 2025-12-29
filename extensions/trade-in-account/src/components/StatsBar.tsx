import {
  InlineStack,
  BlockStack,
  Text,
  Card,
} from '@shopify/ui-extensions-react/customer-account';
import type { CustomerStats } from '../types';

interface StatsBarProps {
  stats: CustomerStats;
}

export function StatsBar({ stats }: StatsBarProps) {
  const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;

  return (
    <InlineStack spacing="base" blockAlignment="stretch">
      <Card padding="base">
        <BlockStack spacing="none" inlineAlignment="center">
          <Text size="large" emphasis="bold">
            {stats.total}
          </Text>
          <Text size="small" appearance="subdued">
            Total
          </Text>
        </BlockStack>
      </Card>
      <Card padding="base">
        <BlockStack spacing="none" inlineAlignment="center">
          <Text size="large" emphasis="bold">
            {stats.pending}
          </Text>
          <Text size="small" appearance="subdued">
            Active
          </Text>
        </BlockStack>
      </Card>
      <Card padding="base">
        <BlockStack spacing="none" inlineAlignment="center">
          <Text size="large" emphasis="bold">
            {stats.completed}
          </Text>
          <Text size="small" appearance="subdued">
            Completed
          </Text>
        </BlockStack>
      </Card>
      <Card padding="base">
        <BlockStack spacing="none" inlineAlignment="center">
          <Text size="large" emphasis="bold" appearance="success">
            {formatCurrency(stats.totalEarned)}
          </Text>
          <Text size="small" appearance="subdued">
            Earned
          </Text>
        </BlockStack>
      </Card>
    </InlineStack>
  );
}
