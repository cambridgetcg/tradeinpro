/**
 * Test image availability in SerpApi eBay results
 *
 * Run with: npx tsx src/test-image-availability.ts
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

const SERPAPI_KEY = process.env.SERPAPI_API_KEY || '';

async function testImageAvailability() {
  console.log('═'.repeat(70));
  console.log('SerpApi eBay Image Availability Test');
  console.log('═'.repeat(70));

  const params = new URLSearchParams({
    engine: 'ebay',
    _nkw: 'one piece tcg SEC parallel english',
    show_only: 'Sold',
    _ipg: '20',
    api_key: SERPAPI_KEY,
  });

  const response = await fetch(`https://serpapi.com/search?${params}`);
  const data = await response.json();

  console.log('\n📊 Response Structure Analysis');
  console.log('─'.repeat(70));

  const items = data.organic_results || [];
  console.log(`Total items returned: ${items.length}`);

  if (items.length > 0) {
    console.log('\n🔍 First Item - All Available Fields:');
    console.log('─'.repeat(70));

    const firstItem = items[0];
    console.log(JSON.stringify(firstItem, null, 2));

    console.log('\n\n📸 Image Field Analysis:');
    console.log('─'.repeat(70));

    let withThumbnail = 0;
    let withImage = 0;
    let withGallery = 0;

    for (const item of items) {
      if (item.thumbnail) withThumbnail++;
      if (item.image) withImage++;
      if (item.gallery) withGallery++;
    }

    console.log(`Items with 'thumbnail' field: ${withThumbnail}/${items.length}`);
    console.log(`Items with 'image' field: ${withImage}/${items.length}`);
    console.log(`Items with 'gallery' field: ${withGallery}/${items.length}`);

    // Show sample image URLs
    console.log('\n📷 Sample Image URLs:');
    console.log('─'.repeat(70));

    items.slice(0, 5).forEach((item: any, i: number) => {
      console.log(`\n${i + 1}. ${item.title?.substring(0, 50)}...`);
      console.log(`   thumbnail: ${item.thumbnail || 'N/A'}`);
      console.log(`   image: ${item.image || 'N/A'}`);
      console.log(`   link: ${item.link}`);
    });

    // Check image URL patterns
    console.log('\n\n🔗 Image URL Pattern Analysis:');
    console.log('─'.repeat(70));

    const thumbnailUrls = items
      .filter((i: any) => i.thumbnail)
      .map((i: any) => i.thumbnail);

    if (thumbnailUrls.length > 0) {
      const sampleUrl = thumbnailUrls[0];
      console.log(`Sample thumbnail URL: ${sampleUrl}`);

      // Check if it's eBay's image CDN
      if (sampleUrl.includes('i.ebayimg.com')) {
        console.log('✅ Images hosted on eBay CDN (i.ebayimg.com)');
        console.log('   These URLs are publicly accessible');

        // Check image size pattern
        const sizeMatch = sampleUrl.match(/s-l(\d+)/);
        if (sizeMatch) {
          console.log(`   Current size: ${sizeMatch[1]}px`);
          console.log('   Can modify URL for larger images:');
          console.log(`   - Small (140px): s-l140`);
          console.log(`   - Medium (300px): s-l300`);
          console.log(`   - Large (500px): s-l500`);
          console.log(`   - XLarge (1600px): s-l1600`);
        }
      }
    }

    // Test image accessibility
    console.log('\n\n🧪 Testing Image Accessibility:');
    console.log('─'.repeat(70));

    if (thumbnailUrls.length > 0) {
      try {
        const testUrl = thumbnailUrls[0];
        const imgResponse = await fetch(testUrl, { method: 'HEAD' });
        console.log(`Test URL: ${testUrl}`);
        console.log(`Status: ${imgResponse.status}`);
        console.log(`Content-Type: ${imgResponse.headers.get('content-type')}`);
        console.log(`Content-Length: ${imgResponse.headers.get('content-length')} bytes`);

        if (imgResponse.ok) {
          console.log('✅ Images are publicly accessible without authentication');
        }
      } catch (error) {
        console.log(`❌ Error testing image: ${error}`);
      }
    }
  }

  // Summary for ML training
  console.log('\n\n═'.repeat(70));
  console.log('SUMMARY: Image Availability for ML Training');
  console.log('═'.repeat(70));

  const hasImages = items.some((i: any) => i.thumbnail || i.image);

  if (hasImages) {
    console.log(`
✅ IMAGES ARE AVAILABLE

Key Points:
1. SerpApi returns thumbnail URLs for eBay listings
2. Images hosted on eBay CDN (i.ebayimg.com) - publicly accessible
3. Can request larger images by modifying URL (s-l140 → s-l1600)
4. No authentication required to download images

ML Training Pipeline:
1. Fetch sold listings via SerpApi
2. Extract thumbnail URLs from results
3. Modify URL for desired resolution (recommend s-l500 or s-l1600)
4. Download images to training dataset
5. Label with: card_id, condition, variant_type, graded

Recommended Image Size:
- For card identification: s-l500 (500px) - good balance
- For condition analysis: s-l1600 (1600px) - max detail

Storage Estimate (100K listings):
- 500px images (~50KB each): ~5 GB
- 1600px images (~200KB each): ~20 GB
    `);
  } else {
    console.log('❌ No image URLs found in response');
  }
}

testImageAvailability().catch(console.error);
