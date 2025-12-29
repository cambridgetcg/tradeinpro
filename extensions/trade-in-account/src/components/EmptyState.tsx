import {
  BlockStack,
  Text,
  Button,
  Icon,
} from '@shopify/ui-extensions-react/customer-account';
import type { FilterTab } from '../types';

interface EmptyStateProps {
  filter: FilterTab;
}

export function EmptyState({ filter }: EmptyStateProps) {
  const messages: Record<FilterTab, { title: string; description: string }> = {
    all: {
      title: 'No trade-ins yet',
      description: 'Start your first trade-in to see it here.',
    },
    active: {
      title: 'No active trade-ins',
      description: 'All your trade-ins have been processed.',
    },
    completed: {
      title: 'No completed trade-ins',
      description: 'Completed trade-ins will appear here.',
    },
    needs_action: {
      title: 'Nothing needs your attention',
      description: "You're all caught up!",
    },
  };

  const { title, description } = messages[filter];

  return (
    <BlockStack spacing="base" inlineAlignment="center" padding="loose">
      <Icon source="note" size="large" appearance="subdued" />
      <Text emphasis="bold">{title}</Text>
      <Text appearance="subdued">{description}</Text>
      {filter === 'all' && (
        <Button to="/pages/trade-in">Start a Trade-In</Button>
      )}
    </BlockStack>
  );
}
