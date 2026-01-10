/**
 * eBay API Access Test Script
 *
 * Tests OAuth authentication and API access levels.
 * Run with: npx tsx src/test-api-access.ts
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') });

interface OAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface ApiTestResult {
  api: string;
  status: 'success' | 'error' | 'unauthorized';
  message: string;
  data?: unknown;
}

const config = {
  appId: process.env.EBAY_APP_ID || '',
  certId: process.env.EBAY_CERT_ID || '',
  devId: process.env.EBAY_DEV_ID || '',
  environment: process.env.EBAY_ENVIRONMENT || 'SANDBOX',
};

// API base URLs
const BASE_URLS = {
  SANDBOX: {
    auth: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    browse: 'https://api.sandbox.ebay.com/buy/browse/v1',
    insights: 'https://api.sandbox.ebay.com/buy/marketplace_insights/v1_beta',
  },
  PRODUCTION: {
    auth: 'https://api.ebay.com/identity/v1/oauth2/token',
    browse: 'https://api.ebay.com/buy/browse/v1',
    insights: 'https://api.ebay.com/buy/marketplace_insights/v1_beta',
  },
};

/**
 * Get OAuth access token using client credentials
 */
async function getAccessToken(): Promise<string> {
  const urls = BASE_URLS[config.environment as keyof typeof BASE_URLS];
  const credentials = Buffer.from(`${config.appId}:${config.certId}`).toString('base64');

  console.log('🔐 Requesting OAuth token...');
  console.log(`   Environment: ${config.environment}`);
  console.log(`   App ID: ${config.appId.substring(0, 20)}...`);

  const response = await fetch(urls.auth, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OAuth failed: ${response.status} - ${error}`);
  }

  const data: OAuthResponse = await response.json();
  console.log(`✅ Token obtained (expires in ${data.expires_in}s)`);

  return data.access_token;
}

/**
 * Test Browse API access
 */
async function testBrowseApi(token: string): Promise<ApiTestResult> {
  const urls = BASE_URLS[config.environment as keyof typeof BASE_URLS];

  console.log('\n📦 Testing Browse API...');

  try {
    // Search for items (simple test query)
    const searchUrl = `${urls.browse}/item_summary/search?q=test&limit=3`;

    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      return {
        api: 'Browse API',
        status: 'unauthorized',
        message: `Access denied (${response.status}) - May need to request production access`,
      };
    }

    if (!response.ok) {
      const error = await response.text();
      return {
        api: 'Browse API',
        status: 'error',
        message: `Error ${response.status}: ${error}`,
      };
    }

    const data = await response.json();
    return {
      api: 'Browse API',
      status: 'success',
      message: `Found ${data.total || 0} items`,
      data: {
        total: data.total,
        itemCount: data.itemSummaries?.length || 0,
        sampleTitles: data.itemSummaries?.slice(0, 2).map((i: any) => i.title),
      },
    };
  } catch (error) {
    return {
      api: 'Browse API',
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test Marketplace Insights API access (sold listings)
 */
async function testInsightsApi(token: string): Promise<ApiTestResult> {
  const urls = BASE_URLS[config.environment as keyof typeof BASE_URLS];

  console.log('\n📊 Testing Marketplace Insights API (sold listings)...');

  try {
    const searchUrl = `${urls.insights}/item_sales/search?q=pokemon&limit=3`;

    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      return {
        api: 'Marketplace Insights API',
        status: 'unauthorized',
        message: 'Access denied - This API requires partner approval',
      };
    }

    if (!response.ok) {
      const error = await response.text();
      return {
        api: 'Marketplace Insights API',
        status: 'error',
        message: `Error ${response.status}: ${error}`,
      };
    }

    const data = await response.json();
    return {
      api: 'Marketplace Insights API',
      status: 'success',
      message: `Access granted! Found ${data.total || 0} sold items`,
      data: {
        total: data.total,
        itemCount: data.itemSales?.length || 0,
      },
    };
  } catch (error) {
    return {
      api: 'Marketplace Insights API',
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check rate limits
 */
async function checkRateLimits(token: string): Promise<void> {
  console.log('\n⏱️  Checking rate limits...');

  const url = config.environment === 'PRODUCTION'
    ? 'https://api.ebay.com/developer/analytics/v1_beta/rate_limit'
    : 'https://api.sandbox.ebay.com/developer/analytics/v1_beta/rate_limit';

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log('   Rate limits:', JSON.stringify(data, null, 2));
    } else {
      console.log(`   Could not fetch rate limits (${response.status})`);
    }
  } catch (error) {
    console.log('   Rate limit check failed:', error);
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('═'.repeat(60));
  console.log('eBay API Access Test');
  console.log('═'.repeat(60));

  // Validate config
  if (!config.appId || !config.certId) {
    console.error('❌ Missing credentials in .env file');
    process.exit(1);
  }

  try {
    // Get OAuth token
    const token = await getAccessToken();

    // Test APIs
    const results: ApiTestResult[] = [];

    results.push(await testBrowseApi(token));
    results.push(await testInsightsApi(token));

    // Check rate limits
    await checkRateLimits(token);

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('SUMMARY');
    console.log('═'.repeat(60));

    for (const result of results) {
      const icon = result.status === 'success' ? '✅' :
                   result.status === 'unauthorized' ? '🔒' : '❌';
      console.log(`${icon} ${result.api}: ${result.message}`);
      if (result.data) {
        console.log(`   Data:`, result.data);
      }
    }

    // Recommendations
    console.log('\n' + '─'.repeat(60));
    console.log('RECOMMENDATIONS');
    console.log('─'.repeat(60));

    if (config.environment === 'SANDBOX') {
      console.log('⚠️  You are using SANDBOX credentials.');
      console.log('   Sandbox has limited/test data only.');
      console.log('   For real TCG data, you need PRODUCTION credentials.');
      console.log('   → Request production access at: https://developer.ebay.com/my/keys');
    }

    const insightsResult = results.find(r => r.api === 'Marketplace Insights API');
    if (insightsResult?.status === 'unauthorized') {
      console.log('\n🔒 Marketplace Insights API (sold listings) requires approval.');
      console.log('   Options:');
      console.log('   1. Apply for partner access (difficult for independents)');
      console.log('   2. Use SerpApi ($50/mo) for sold listings data');
      console.log('   3. Use Apify scrapers as backup');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
