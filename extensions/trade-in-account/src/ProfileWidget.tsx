import {
  reactExtension,
  Card,
  BlockStack,
  Text,
  Link,
} from '@shopify/ui-extensions-react/customer-account';

const TRADE_IN_URL = 'https://www.cambridgetcg.com/pages/trade-in';

export default reactExtension(
  'customer-account.profile.block.render',
  () => <ProfileWidget />
);

function ProfileWidget() {
  return (
    <Card title="Trade-In Program">
      <BlockStack spacing="base">
        <Text>
          Turn your trading cards into store credit or cash. Get up to 70% of market value, plus a 10% bonus when you choose store credit.
        </Text>
        <Link to={TRADE_IN_URL} external>
          Start a Trade-In →
        </Link>
      </BlockStack>
    </Card>
  );
}
