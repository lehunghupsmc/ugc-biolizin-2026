// Diagnose: Test Apify actor with different tokens and URL formats
require('dotenv').config();
const { ApifyClient } = require('apify-client');
const config = require('../src/config');

async function testActor(label, token, input) {
  console.log(`\n--- ${label} ---`);
  try {
    const client = new ApifyClient({ token });
    const run = await client.actor('social_developer/facebook-playcount-scraper').call(input, { timeout: 60 });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`  Items: ${items.length}`);
    for (const item of items) {
      console.log(`  ${item.url} => play_count=${item.play_count}, status=${item.status}`);
    }
    return items;
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    return [];
  }
}

async function main() {
  const mainToken = config.APIFY_TOKEN;
  const fbToken1 = config.APIFY_FB_TOKENS[0];
  
  // Test 1: FB Token with share URLs
  await testActor('FB Token 1 + share URLs', fbToken1, {
    startUrls: [
      { url: 'https://www.facebook.com/share/r/19PSfWGzLW/?mibextid=wwXIfr' },
      { url: 'https://www.facebook.com/share/r/18pkuGy6xH/?mibextid=wwXIfr' }
    ]
  });

  // Test 2: Main token with share URLs 
  await testActor('Main APIFY_TOKEN + share URLs', mainToken, {
    startUrls: [
      { url: 'https://www.facebook.com/share/r/19PSfWGzLW/?mibextid=wwXIfr' },
      { url: 'https://www.facebook.com/share/r/18pkuGy6xH/?mibextid=wwXIfr' }
    ]
  });

  // Test 3: FB Token with watch format (actor normalizes to this anyway)
  await testActor('FB Token 1 + watch URLs', fbToken1, {
    startUrls: [
      { url: 'https://www.facebook.com/watch/?v=1294322488498498' }
    ]
  });

  console.log('\n=== DONE ===');
}

main().catch(e => console.error('Fatal:', e));
