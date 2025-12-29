import {
  InlineStack,
  BlockStack,
  Text,
  Icon,
  View,
} from '@shopify/ui-extensions-react/customer-account';
import type { TimelineStep } from '../types';

interface TimelineProps {
  steps: TimelineStep[];
}

export function Timeline({ steps }: TimelineProps) {
  return (
    <InlineStack spacing="none" blockAlignment="start" inlineAlignment="center">
      {steps.map((step, index) => (
        <InlineStack key={step.status} spacing="none" blockAlignment="center">
          <BlockStack spacing="none" inlineAlignment="center">
            <Icon
              source={
                step.isComplete
                  ? 'checkCircle'
                  : step.isCurrent
                    ? 'clock'
                    : 'hollowCircle'
              }
              appearance={
                step.isComplete
                  ? 'success'
                  : step.isCurrent
                    ? 'accent'
                    : 'subdued'
              }
            />
            <Text
              size="small"
              appearance={
                step.isComplete || step.isCurrent ? undefined : 'subdued'
              }
              emphasis={step.isCurrent ? 'bold' : undefined}
            >
              {step.label}
            </Text>
            {step.timestamp && (
              <Text size="small" appearance="subdued">
                {new Date(step.timestamp).toLocaleDateString()}
              </Text>
            )}
          </BlockStack>
          {index < steps.length - 1 && (
            <View padding="tight">
              <Text appearance={step.isComplete ? 'success' : 'subdued'}>
                —
              </Text>
            </View>
          )}
        </InlineStack>
      ))}
    </InlineStack>
  );
}
