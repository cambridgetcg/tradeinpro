/**
 * Test Bright Data Web Unlocker API
 */

const API_TOKEN = '***REMOVED-ROTATE-ME***';

async function testWebUnlocker() {
  const targetUrl = 'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn';

  console.log('Testing Bright Data Web Unlocker API...');
  console.log('Target URL:', targetUrl);

  try {
    // Use Bright Data's Web Unlocker API
    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify({
        zone: 'mcp_unlocker',
        url: targetUrl,
        format: 'raw',
      }),
    });

    console.log('Response status:', response.status);

    if (response.ok) {
      const html = await response.text();
      console.log('HTML length:', html.length);

      const blocked = html.includes('Just a moment') || html.includes('Verify you are human');
      console.log('Blocked by Cloudflare?', blocked);

      if (!blocked) {
        // Check for table rows
        const rowMatches = html.match(/class="[^"]*table-body[^"]*"/g);
        console.log('Has table-body?', rowMatches ? 'Yes' : 'No');

        // Count product links
        const linkMatches = html.match(/href="[^"]*\/Products\/Singles\/[^"]*"/g);
        console.log('Product links found:', linkMatches?.length || 0);

        if (linkMatches && linkMatches.length > 0) {
          console.log('Sample links:', linkMatches.slice(0, 3));
        }
      }
    } else {
      const error = await response.text();
      console.log('Error response:', error);
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
  }
}

testWebUnlocker();
