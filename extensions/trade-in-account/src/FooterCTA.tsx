import {
  reactExtension,
  Banner,
  InlineStack,
  BlockStack,
  Text,
  Button,
} from '@shopify/ui-extensions-react/customer-account';

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
          <Text size="small">
            Get up to 70% of market value + 10% bonus with store credit
          </Text>
        </BlockStack>
        <Button to="/pages/trade-in">Start Trade-In</Button>
      </InlineStack>
    </Banner>
  );
}
