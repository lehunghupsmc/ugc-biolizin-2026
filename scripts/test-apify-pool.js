// Quick test: Apify token pool with fixed startUrls format
require('dotenv').config();
const { ApifyTokenPool } = require('../src/scrapers/apify-token-pool');
const config = require('../src/config');

async function main() {
  const pool = new ApifyTokenPool(config.APIFY_FB_TOKENS);
  console.log(`Pool: ${pool.availableCount} tokens`);
  
  // Test with verified working reel URLs
  const testUrls = [
    'https://www.facebook.com/reel/28209425325388636',
    'https://www.facebook.com/reel/1080266861074047'
  ];

  console.log(`Testing ${testUrls.length} URLs...`);
  const { results, failedUrls } = await pool.scrapePlayCounts(testUrls);

  console.log(`\nResults: ${results.size} play_counts`);
  for (const [id, pc] of results) {
    console.log(`  Video ${id}: ${typeof pc === 'number' ? pc.toLocaleString() : pc} plays`);
  }
  console.log(`Failed: ${failedUrls.length}`);
  console.log(results.size > 0 ? '\nPASS: Token pool works!' : '\nFAIL: No results');
}

main().catch(e => console.error('Fatal:', e));
