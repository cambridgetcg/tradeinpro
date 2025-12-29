import {
  InlineStack,
  Pressable,
  Text,
  Badge,
} from '@shopify/ui-extensions-react/customer-account';
import type { FilterTab } from '../types';

interface FilterTabsProps {
  active: FilterTab;
  onChange: (tab: FilterTab) => void;
  counts: Record<FilterTab, number>;
}

export function FilterTabs({ active, onChange, counts }: FilterTabsProps) {
  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Completed' },
    { key: 'needs_action', label: 'Needs Action' },
  ];

  return (
    <InlineStack spacing="tight">
      {tabs.map(({ key, label }) => (
        <Pressable key={key} onPress={() => onChange(key)}>
          <InlineStack spacing="tight" blockAlignment="center">
            <Text
              emphasis={active === key ? 'bold' : undefined}
              appearance={active === key ? undefined : 'subdued'}
            >
              {label}
            </Text>
            {counts[key] > 0 && (
              <Badge
                tone={
                  key === 'needs_action' && counts[key] > 0
                    ? 'warning'
                    : undefined
                }
              >
                {counts[key]}
              </Badge>
            )}
          </InlineStack>
        </Pressable>
      ))}
    </InlineStack>
  );
}
