import {
  reactExtension,
  Page,
  BlockStack,
  Card,
  Text,
  Link,
  InlineStack,
} from '@shopify/ui-extensions-react/customer-account';

const TRADE_IN_URL = 'https://www.cambridgetcg.com/pages/trade-in';

export default reactExtension(
  'customer-account.page.render',
  () => <TradeInPage />
);

function TradeInPage() {
  return (
    <Page title="Trade-In Program">
      <BlockStack spacing="loose">
        {/* Hero Card */}
        <Card>
          <BlockStack spacing="base">
            <Text emphasis="bold" size="large">
              Turn Your Cards Into Value
            </Text>
            <Text>
              Submit your trading cards for a competitive offer. Get up to 70% of market value,
              with a 10% bonus when you choose store credit.
            </Text>
            <Link to={TRADE_IN_URL} external>
              Start a New Trade-In →
            </Link>
          </BlockStack>
        </Card>

        {/* How It Works */}
        <Card>
          <BlockStack spacing="base">
            <Text emphasis="bold">How It Works</Text>

            <InlineStack spacing="base" blockAlignment="start">
              <Text emphasis="bold">1.</Text>
              <BlockStack spacing="extraTight">
                <Text emphasis="bold">Search & Add Cards</Text>
                <Text size="small" appearance="subdued">
                  Find your cards and select their condition
                </Text>
              </BlockStack>
            </InlineStack>

            <InlineStack spacing="base" blockAlignment="start">
              <Text emphasis="bold">2.</Text>
              <BlockStack spacing="extraTight">
                <Text emphasis="bold">Get Your Quote</Text>
                <Text size="small" appearance="subdued">
                  See instant pricing based on current market values
                </Text>
              </BlockStack>
            </InlineStack>

            <InlineStack spacing="base" blockAlignment="start">
              <Text emphasis="bold">3.</Text>
              <BlockStack spacing="extraTight">
                <Text emphasis="bold">Ship Your Cards</Text>
                <Text size="small" appearance="subdued">
                  Send us your cards with the provided packing slip
                </Text>
              </BlockStack>
            </InlineStack>

            <InlineStack spacing="base" blockAlignment="start">
              <Text emphasis="bold">4.</Text>
              <BlockStack spacing="extraTight">
                <Text emphasis="bold">Get Paid</Text>
                <Text size="small" appearance="subdued">
                  Receive store credit or bank transfer after verification
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Benefits */}
        <Card>
          <BlockStack spacing="base">
            <Text emphasis="bold">Why Trade With Us?</Text>
            <BlockStack spacing="tight">
              <Text>✓ Competitive prices based on live market data</Text>
              <Text>✓ 10% bonus when you choose store credit</Text>
              <Text>✓ Fast processing - typically 2-3 business days</Text>
              <Text>✓ Free shipping on orders over £50</Text>
            </BlockStack>
          </BlockStack>
        </Card>

        {/* CTA */}
        <Card>
          <BlockStack spacing="base" inlineAlignment="center">
            <Text>Ready to get started?</Text>
            <Link to={TRADE_IN_URL} external>
              Start Your Trade-In Now →
            </Link>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
