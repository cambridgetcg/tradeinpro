/**
 * Multi-Game API Test Script
 *
 * Tests the API clients for different TCGs.
 * Run with: npm run test:optcg
 */
import { createClientForGame, getEnabledGames, getSetsByGame, } from '../src/index.js';
async function testGame(game, setCode) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${game.toUpperCase()}`);
    console.log('='.repeat(60));
    const client = createClientForGame(game);
    if (!client) {
        console.log(`⚠️  No API client available for ${game}`);
        return;
    }
    try {
        // Test 1: Fetch sets
        console.log('\n1. Fetching available sets...');
        const sets = await client.getSets();
        console.log(`   ✅ Found ${sets.length} sets`);
        if (sets.length > 0) {
            console.log('   Sample sets:', sets.slice(0, 3).map((s) => s.code).join(', '));
        }
        // Test 2: Fetch cards from a set
        const testSet = setCode || sets[0]?.code;
        if (testSet) {
            console.log(`\n2. Fetching cards from set: ${testSet}...`);
            const cards = await client.getCardsBySet(testSet);
            console.log(`   ✅ Found ${cards.length} cards`);
            // Test 3: Get cards with prices
            console.log('\n3. Filtering cards with prices...');
            const cardsWithPrices = cards.filter((c) => c.priceUsd && c.priceUsd > 0);
            console.log(`   ✅ Found ${cardsWithPrices.length} cards with prices`);
            // Show top 5 most expensive
            if (cardsWithPrices.length > 0) {
                const sortedByPrice = cardsWithPrices
                    .sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0))
                    .slice(0, 5);
                console.log('\n   Top 5 most expensive cards:');
                sortedByPrice.forEach((card, i) => {
                    console.log(`   ${i + 1}. ${card.name} (${card.cardNumber}) - $${card.priceUsd?.toFixed(2)} / £${card.priceGbp?.toFixed(2)}`);
                });
            }
        }
        // Test 4: Search
        console.log('\n4. Testing search...');
        const searchResults = await client.searchCards({ limit: 5 });
        console.log(`   ✅ Search returned ${searchResults.length} results`);
        // Get stats
        console.log('\n5. API Statistics:');
        const stats = client.getStats();
        console.log(`   Total requests: ${stats.requestCount}`);
        console.log(`   Errors: ${stats.errorCount}`);
        console.log(`   Avg response time: ${stats.averageResponseTime.toFixed(0)}ms`);
        console.log(`\n✅ ${game.toUpperCase()} tests passed!`);
    }
    catch (error) {
        console.error(`\n❌ ${game.toUpperCase()} test failed:`, error);
    }
}
async function main() {
    console.log('🎴 Multi-Game TCG API Test Suite\n');
    // Show enabled games
    const enabledGames = getEnabledGames();
    console.log(`Enabled games: ${enabledGames.map((g) => g.name).join(', ')}`);
    // Show registered sets for One Piece
    const opSets = getSetsByGame('onepiece');
    console.log(`One Piece sets registered: ${opSets.length}`);
    // Test One Piece (OPTCG API)
    await testGame('onepiece', 'OP01');
    // Test Pokemon (Pokemon TCG API) - commented out to avoid rate limits
    // Uncomment to test: await testGame('pokemon', 'sv1');
    console.log('\n' + '='.repeat(60));
    console.log('All tests completed!');
    console.log('='.repeat(60));
}
main().catch(console.error);
//# sourceMappingURL=test-optcg-api.js.map