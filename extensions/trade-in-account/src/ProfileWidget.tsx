import {
  reactExtension,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
} from '@shopify/ui-extensions-react/customer-account';

const TRADE_IN_URL = 'https://www.cambridgetcg.com/pages/trade-in';

export default reactExtension(
  'customer-account.profile.block.render',
  () => <ProfileWidget />
);

function ProfileWidget() {
  return (
    <Card padding>
      <BlockStack spacing="base">
        <InlineStack spacing="loose" blockAlignment="center" inlineAlignment="space-between">
          <Text emphasis="bold">Trade-In</Text>
          <Button kind="secondary" to={TRADE_IN_URL}>
            Start a trade-in
          </Button>
        </InlineStack>
        <Text appearance="subdued">
          Turn your trading cards into store credit or cash. Get up to 70% of market value, plus a 10% bonus when you choose store credit.
        </Text>
      </BlockStack>
    </Card>
  );
}
