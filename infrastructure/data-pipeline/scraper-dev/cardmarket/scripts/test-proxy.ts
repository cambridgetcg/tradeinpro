/**
 * Quick proxy diagnostic script
 */
import { HttpsProxyAgent } from 'https-proxy-agent';

const customerId = process.env.BRIGHT_DATA_CUSTOMER || 'hl_2d97e1e0';
const password = process.env.BRIGHT_DATA_PASSWORD || '***REMOVED-ROTATE-ME***';

// Build Bright Data proxy URL
const proxyUrl = `http://${customerId}-country-de:${password}@brd.superproxy.io:22225`;
console.log('Testing proxy:', proxyUrl.replace(password, '***'));

const agent = new HttpsProxyAgent(proxyUrl);

async function testProxy() {
  try {
    // First test: Check our IP via httpbin
    console.log('\n1. Testing proxy with httpbin...');
    const ipResponse = await fetch('https://httpbin.org/ip', { agent } as any);
    const ipData = await ipResponse.json();
    console.log('   IP Response:', ipData);

    // Second test: Try CardMarket
    console.log('\n2. Testing CardMarket...');
    const cmResponse = await fetch('https://www.cardmarket.com/en/OnePiece', {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9,de;q=0.8',
      }
    } as any);
    console.log('   Status:', cmResponse.status, cmResponse.statusText);

    const body = await cmResponse.text();
    console.log('   Body length:', body.length);
    console.log('   Contains "cardmarket":', body.toLowerCase().includes('cardmarket'));

    if (cmResponse.status === 200) {
      console.log('\n✅ Proxy working! CardMarket accessible.');
    } else {
      console.log('\n⚠️ CardMarket returned:', cmResponse.status);
      console.log('   First 500 chars:', body.substring(0, 500));
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testProxy();
