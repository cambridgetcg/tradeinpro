/**
 * Quick collector test - Debug URL generation
 */

const API_KEY = '***REMOVED-ROTATE-ME***';

async function testDirect(name: string, params: Record<string, string>) {
  const urlParams = new URLSearchParams({
    api_key: API_KEY,
    ...params,
  });
  const url = `https://serpapi.com/search?${urlParams}`;
  console.log(`\n${name}:`);
  console.log(`  URL: ${url.replace(API_KEY, 'KEY')}`);

  const response = await fetch(url);
  console.log(`  Status: ${response.status}`);

  if (response.ok) {
    const data = await response.json();
    console.log(`  Results: ${data.search_information?.total_results || 0}`);
    console.log(`  Returned: ${data.organic_results?.length || 0}`);
  } else {
    const text = await response.text();
    console.log(`  Error: ${text.substring(0, 200)}`);
  }
}

async function main() {
  console.log('Debugging SerpAPI URL construction...');

  // Test 1: Minimal params (like test-serpapi.ts that works)
  await testDirect('Test 1: Minimal params (working test-serpapi style)', {
    engine: 'ebay',
    _nkw: 'one piece tcg',
    show_only: 'Sold',
    _ipg: '50',
  });

  // Test 2: Add _pgn (page number)
  await testDirect('Test 2: With _pgn page number', {
    engine: 'ebay',
    _nkw: 'one piece tcg',
    show_only: 'Sold',
    _ipg: '60',
    _pgn: '1',
  });

  // Test 3: Add category
  await testDirect('Test 3: With _sacat category', {
    engine: 'ebay',
    _nkw: 'one piece tcg',
    show_only: 'Sold',
    _ipg: '60',
    _sacat: '183454',
  });

  // Test 4: Add sort
  await testDirect('Test 4: With _sop sort', {
    engine: 'ebay',
    _nkw: 'one piece tcg',
    show_only: 'Sold',
    _ipg: '60',
    _sop: '13',
  });

  // Test 5: All collector params
  await testDirect('Test 5: All collector params combined', {
    engine: 'ebay',
    _nkw: 'one piece tcg',
    show_only: 'Sold',
    _ipg: '60',
    _pgn: '1',
    _sacat: '183454',
    _sop: '13',
  });

  // Test 6: Check if _ipg=60 is the problem
  await testDirect('Test 6: With _ipg=200', {
    engine: 'ebay',
    _nkw: 'one piece tcg',
    show_only: 'Sold',
    _ipg: '200',
  });

  console.log('\nDone!');
}

main();
