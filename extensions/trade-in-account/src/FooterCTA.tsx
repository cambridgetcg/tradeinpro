import {
  reactExtension,
  Banner,
  InlineStack,
  BlockStack,
  Text,
  Button,
} from '@shopify/ui-extensions-react/customer-account';

const TRADE_IN_URL = 'https://www.cambridgetcg.com/pages/trade-in';

export default reactExtension(
  'customer-account.footer.render-after',
  () => <FooterCTA />
);

function FooterCTA() {
  return (
    <Banner status="info">
      <InlineStack
        inlineAlignment="space-between"
        blockAlignment="center"
        spacing="base"
      >
        <BlockStack spacing="none">
          <Text emphasis="bold">Have trading cards to sell?</Text>
          <Text size="small" appearance="subdued">
            Get up to 70% of market value + 10% bonus with store credit
          </Text>
        </BlockStack>
        <Button kind="secondary" to={TRADE_IN_URL}>
          Start trade-in
        </Button>
      </InlineStack>
    </Banner>
  );
}
