/**
 * Test end-to-end hybrid pipeline: Bright Data + Apify Token Pool
 * Chạy: node scripts/test-hybrid-pipeline.js
 */
require('dotenv').config();
const { scrapeFacebookBatch, extractVideoId, resolveShareUrl } = require('../src/scrapers/facebook');
const { mapFacebookMetrics } = require('../src/services/metric-mapper');
const config = require('../src/config');

const TEST_URLS = [
  'https://www.facebook.com/share/r/19PSfWGzLW/?mibextid=wwXIfr',
  'https://www.facebook.com/share/r/18pkuGy6xH/?mibextid=wwXIfr',
  'https://www.facebook.com/share/v/15sYBFn1Wj/?mibextid=wwXIfr'
];

async function main() {
  console.log('='.repeat(70));
  console.log('TEST HYBRID PIPELINE: Bright Data + Apify Token Pool');
  console.log('='.repeat(70));
  console.log(`APIFY_FB_TOKENS: ${config.APIFY_FB_TOKENS.length} tokens`);
  console.log(`BRIGHTDATA_API_TOKEN: ${config.BRIGHTDATA_API_TOKEN ? 'SET' : 'NOT SET'}`);
  console.log(`Test URLs: ${TEST_URLS.length}`);
  console.log('-'.repeat(70));

  // Step 0: Test URL resolution
  console.log('\n📡 Test URL Resolution...');
  for (const url of TEST_URLS) {
    const resolved = await resolveShareUrl(url);
    const videoId = extractVideoId(resolved);
    console.log(`  ${url.slice(0, 50)}...`);
    console.log(`    → Resolved: ${resolved.slice(0, 80)}...`);
    console.log(`    → Video ID: ${videoId || 'N/A'}`);
  }

  // Step 1: Run full hybrid pipeline
  console.log('\n🚀 Running scrapeFacebookBatch()...');
  const startTime = Date.now();

  const results = await scrapeFacebookBatch(TEST_URLS);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️ Pipeline hoàn tất trong ${elapsed}s`);
  console.log('-'.repeat(70));

  // Step 2: Analyze results
  let okCount = 0, errorCount = 0, hasPlayCount = 0;

  for (const [url, result] of results) {
    console.log(`\n📌 ${url.slice(0, 60)}...`);
    
    if (!result.ok) {
      console.log(`  ❌ Error: ${result.errorType} - ${result.errorMessage}`);
      errorCount++;
      continue;
    }

    okCount++;
    const d = result.data;
    
    // Test mapFacebookMetrics
    const metrics = mapFacebookMetrics(d);
    
    console.log(`  ✅ Status: OK`);
    console.log(`  👤 Author: ${d.author_name || d.user_handle || 'N/A'}`);
    console.log(`  📝 Content: ${(d.content || '').slice(0, 60)}...`);
    console.log(`  📊 Raw fields:`);
    console.log(`     play_count:       ${d.play_count ?? 'null'}`);
    console.log(`     video_view_count: ${d.video_view_count ?? 'null'}`);
    console.log(`     likes:            ${d.likes ?? 'null'}`);
    console.log(`     num_comments:     ${d.num_comments ?? 'null'}`);
    console.log(`     num_shares:       ${d.num_shares ?? 'null'}`);
    console.log(`  🎯 Mapped metrics (sau mapFacebookMetrics):`);
    console.log(`     view:    ${metrics.view}`);
    console.log(`     react:   ${metrics.react}`);
    console.log(`     comment: ${metrics.comment}`);
    console.log(`     share:   ${metrics.share}`);

    if (metrics.view !== null && metrics.view > 0) hasPlayCount++;
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 KẾT QUẢ TỔNG HỢP');
  console.log('='.repeat(70));
  console.log(`  Tổng URLs:          ${TEST_URLS.length}`);
  console.log(`  OK:                 ${okCount}`);
  console.log(`  Error:              ${errorCount}`);
  console.log(`  Có play_count:      ${hasPlayCount}/${okCount}`);
  console.log(`  Thời gian:          ${elapsed}s`);
  
  const allHavePlayCount = hasPlayCount === okCount && okCount > 0;
  console.log(`\n${allHavePlayCount ? '✅ PIPELINE HOẠT ĐỘNG ĐÚNG!' : '⚠️ Một số video thiếu play_count'}`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
