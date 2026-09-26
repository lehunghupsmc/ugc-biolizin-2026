const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ApifyClient } = require('apify-client');
const config = require('../src/config');
const { scrapeFacebookBatch } = require('../src/scrapers/facebook');

function parseArgs() {
  const args = process.argv.slice(2);
  let inputFile = 'D:\\Download\\url-ugc-biolizin-26.9.2026.xlsx';
  let platform = 'all'; // 'all', 'tiktok', 'facebook'
  let limit = null;
  let tiktokBatchSize = 60;
  let facebookBatchSize = 100;

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      inputFile = arg.slice(8).replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('--platform=')) {
      platform = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--tiktok-batch-size=')) {
      tiktokBatchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--facebook-batch-size=')) {
      facebookBatchSize = parseInt(arg.split('=')[1], 10);
    }
  }

  return { inputFile, platform, limit, tiktokBatchSize, facebookBatchSize };
}

function formatDateForFolder(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}${m}${d}_${hh}${mm}${ss}`;
}

function extractUrlsFromExcel(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }

  console.log(`[UGCExporter] 📂 Extracting URLs from Excel: ${filePath}`);
  const pyCode = `import openpyxl, json; wb=openpyxl.load_workbook(r'''${filePath}''', read_only=True); data={name: list(dict.fromkeys(str(c).strip() for row in wb[name].iter_rows(values_only=True) for c in row if c and isinstance(c, str) and c.strip().startswith('http'))) for name in wb.sheetnames}; print(json.dumps(data))`;

  const stdout = execSync(`python -c "${pyCode}"`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });

  return JSON.parse(stdout);
}

async function scrapeTikTok(urls, outputDir, batchSize, apifyToken) {
  console.log(`\n================================================================`);
  console.log(`🎵 STARTING TIKTOK SCRAPING (${urls.length} URLs)`);
  console.log(`================================================================`);

  const tiktokDir = path.join(outputDir, 'tiktok');
  const itemsDir = path.join(tiktokDir, 'items');
  fs.mkdirSync(itemsDir, { recursive: true });

  const client = new ApifyClient({ token: apifyToken });
  const batches = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    batches.push(urls.slice(i, i + batchSize));
  }

  console.log(`[TikTok] Splitting into ${batches.length} batch(es) of size ~${batchSize}...`);

  const allScrapedItems = [];
  const batchRuns = [];

  for (let b = 0; b < batches.length; b++) {
    const batchUrls = batches[b];
    console.log(`\n[TikTok] 🚀 [Batch ${b + 1}/${batches.length}] Sending ${batchUrls.length} URLs to Apify...`);
    const startTime = Date.now();

    const input = {
      postURLs: batchUrls,
      commentsPerPost: 0,
      maxPostsPerQuery: batchUrls.length
    };

    try {
      const run = await client.actor('clockworks/free-tiktok-scraper').call(input, {
        timeout: 600,
        memory: 2048
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems({
        limit: 1000
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[TikTok] ✅ [Batch ${b + 1}/${batches.length}] Retrieved ${items.length} items in ${elapsed}s (Run ID: ${run.id})`);

      batchRuns.push({
        batch: b + 1,
        totalUrls: batchUrls.length,
        ok: true,
        itemsCount: items.length,
        runId: run.id,
        error: null
      });

      if (items.length > 0) {
        allScrapedItems.push(...items);
      }
    } catch (err) {
      console.error(`[TikTok] ❌ [Batch ${b + 1}/${batches.length}] Error:`, err.message);
      batchRuns.push({
        batch: b + 1,
        totalUrls: batchUrls.length,
        ok: false,
        itemsCount: 0,
        error: err.message
      });
    }

    if (b < batches.length - 1) {
      console.log(`[TikTok] Resting 3s before next batch...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Save individual files
  const itemIndex = [];
  for (let idx = 0; idx < allScrapedItems.length; idx++) {
    const item = allScrapedItems[idx];
    const rawId = String(item.id || item.videoId || `item_${idx + 1}`);
    const safeId = rawId.replace(/[/\\?%*:|"<>]/g, '_');
    const fileName = `${safeId}.json`;
    const filePath = path.join(itemsDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf8');

    itemIndex.push({
      index: idx + 1,
      id: rawId,
      url: item.webVideoUrl || item.url || item.inputUrl || item.submittedVideoUrl || '',
      author: item.authorMeta?.name || item.authorMeta?.nickName || '',
      views: item.playCount ?? item.stats?.playCount ?? null,
      likes: item.diggCount ?? item.stats?.diggCount ?? null,
      comments: item.commentCount ?? item.stats?.commentCount ?? null,
      shares: item.shareCount ?? item.stats?.shareCount ?? null,
      file: `items/${fileName}`
    });
  }

  // Save all items
  const allDataFile = path.join(tiktokDir, 'all_tiktok_data.json');
  fs.writeFileSync(allDataFile, JSON.stringify(allScrapedItems, null, 2), 'utf8');

  // Save index overview
  const indexFile = path.join(tiktokDir, 'index_overview.json');
  fs.writeFileSync(indexFile, JSON.stringify(itemIndex, null, 2), 'utf8');

  // Save summary
  const summary = {
    platform: 'tiktok',
    exported_at: new Date().toISOString(),
    total_input_urls: urls.length,
    total_batches: batches.length,
    total_items_scraped: allScrapedItems.length,
    total_files_saved: allScrapedItems.length,
    batches: batchRuns,
    output_files: {
      all_data_json: allDataFile,
      items_directory: itemsDir,
      index_overview_json: indexFile
    }
  };
  const summaryFile = path.join(tiktokDir, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`[TikTok] 🎉 Done! ${allScrapedItems.length} videos saved to ${tiktokDir}`);
  return summary;
}

async function scrapeFacebook(urls, outputDir, batchSize) {
  console.log(`\n================================================================`);
  console.log(`📘 STARTING FACEBOOK SCRAPING (${urls.length} URLs)`);
  console.log(`================================================================`);

  const fbDir = path.join(outputDir, 'facebook');
  const itemsDir = path.join(fbDir, 'items');
  fs.mkdirSync(itemsDir, { recursive: true });

  const batches = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    batches.push(urls.slice(i, i + batchSize));
  }

  console.log(`[Facebook] Splitting into ${batches.length} batch(es) of size ~${batchSize}...`);

  const allScrapedItems = [];
  const batchRuns = [];

  for (let b = 0; b < batches.length; b++) {
    const batchUrls = batches[b];
    console.log(`\n[Facebook] 🚀 [Batch ${b + 1}/${batches.length}] Scraping ${batchUrls.length} Facebook URLs...`);
    const startTime = Date.now();

    try {
      const resultsMap = await scrapeFacebookBatch(batchUrls);
      const batchItems = [];
      let successCount = 0;
      let errorCount = 0;

      for (const [url, res] of resultsMap.entries()) {
        if (res.ok && res.data) {
          batchItems.push(res.data);
          successCount++;
        } else {
          errorCount++;
          // Giữ lại bản ghi lỗi để người dùng biết URL nào lỗi
          batchItems.push({
            url,
            status: 'error',
            errorType: res.errorType || 'UNKNOWN_ERROR',
            errorMessage: res.errorMessage || 'No data returned'
          });
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Facebook] ✅ [Batch ${b + 1}/${batches.length}] Finished in ${elapsed}s: ${successCount} OK, ${errorCount} errors`);

      batchRuns.push({
        batch: b + 1,
        totalUrls: batchUrls.length,
        ok: true,
        successCount,
        errorCount,
        elapsedSeconds: elapsed
      });

      allScrapedItems.push(...batchItems);
    } catch (err) {
      console.error(`[Facebook] ❌ [Batch ${b + 1}/${batches.length}] Batch failure:`, err.message);
      batchRuns.push({
        batch: b + 1,
        totalUrls: batchUrls.length,
        ok: false,
        error: err.message
      });
    }

    if (b < batches.length - 1) {
      console.log(`[Facebook] Resting 5s before next batch...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Save individual files
  const itemIndex = [];
  for (let idx = 0; idx < allScrapedItems.length; idx++) {
    const item = allScrapedItems[idx];
    const rawId = String(item.post_id || item.shortcode || item.id || `fb_item_${idx + 1}`);
    const safeId = rawId.replace(/[/\\?%*:|"<>]/g, '_');
    const fileName = `${safeId}.json`;
    const filePath = path.join(itemsDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf8');

    // Trích xuất views
    const views = item.play_count ?? item.video_view_count ?? item.views ?? null;
    let likes = item.likes ?? item.reactions_count ?? null;
    if (likes === null && Array.isArray(item.num_likes_type)) {
      likes = item.num_likes_type.reduce((acc, curr) => acc + (Number(curr?.num) || 0), 0);
    }
    const comments = item.num_comments ?? item.comments_count ?? null;
    const shares = item.num_shares ?? item.shares_count ?? null;

    itemIndex.push({
      index: idx + 1,
      id: rawId,
      url: item.url || item.input?.url || '',
      author: item.user_username_raw || item.user_handle || item.user_name || '',
      views: typeof views === 'number' ? views : (Number(views) || null),
      likes: typeof likes === 'number' ? likes : (Number(likes) || null),
      comments: typeof comments === 'number' ? comments : (Number(comments) || null),
      shares: typeof shares === 'number' ? shares : (Number(shares) || null),
      status: item.status || (item.error ? 'error' : 'ok'),
      file: `items/${fileName}`
    });
  }

  // Save all items
  const allDataFile = path.join(fbDir, 'all_facebook_data.json');
  fs.writeFileSync(allDataFile, JSON.stringify(allScrapedItems, null, 2), 'utf8');

  // Save index overview
  const indexFile = path.join(fbDir, 'index_overview.json');
  fs.writeFileSync(indexFile, JSON.stringify(itemIndex, null, 2), 'utf8');

  // Save summary
  const summary = {
    platform: 'facebook',
    exported_at: new Date().toISOString(),
    total_input_urls: urls.length,
    total_batches: batches.length,
    total_items_scraped: allScrapedItems.length,
    total_files_saved: allScrapedItems.length,
    batches: batchRuns,
    output_files: {
      all_data_json: allDataFile,
      items_directory: itemsDir,
      index_overview_json: indexFile
    }
  };
  const summaryFile = path.join(fbDir, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`[Facebook] 🎉 Done! ${allScrapedItems.length} items saved to ${fbDir}`);
  return summary;
}

async function main() {
  const { inputFile, platform, limit, tiktokBatchSize, facebookBatchSize } = parseArgs();

  console.log('================================================================');
  console.log('🚀 UGC BIOLIZIN MULTI-PLATFORM RAW DATA EXPORTER');
  console.log(`Input File: ${inputFile}`);
  console.log(`Platform:   ${platform}`);
  console.log('================================================================');

  const excelData = extractUrlsFromExcel(inputFile);

  let tiktokUrls = excelData['tiktok'] || [];
  let facebookUrls = excelData['facebook'] || [];

  console.log(`[UGCExporter] Found ${tiktokUrls.length} unique TikTok URLs.`);
  console.log(`[UGCExporter] Found ${facebookUrls.length} unique Facebook URLs.`);

  if (limit && limit > 0) {
    console.log(`[UGCExporter] ⚠️ LIMIT APPLIED: ${limit} URLs per platform.`);
    tiktokUrls = tiktokUrls.slice(0, limit);
    facebookUrls = facebookUrls.slice(0, limit);
  }

  const timestampStr = formatDateForFolder(new Date());
  const outputDir = path.join(process.cwd(), 'output', `ugc_export_${timestampStr}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const finalSummary = {
    input_file: inputFile,
    exported_at: new Date().toISOString(),
    output_directory: outputDir,
    tiktok: null,
    facebook: null
  };

  const scrapeTasks = [];

  // 1. TikTok
  if (platform === 'all' || platform === 'tiktok') {
    if (tiktokUrls.length > 0) {
      if (!config.APIFY_TOKEN) {
        console.error('❌ APIFY_TOKEN is missing. Skipping TikTok.');
      } else {
        scrapeTasks.push(
          scrapeTikTok(tiktokUrls, outputDir, tiktokBatchSize, config.APIFY_TOKEN)
            .then(res => { finalSummary.tiktok = res; })
        );
      }
    }
  }

  // 2. Facebook
  if (platform === 'all' || platform === 'facebook') {
    if (facebookUrls.length > 0) {
      if (!config.BRIGHTDATA_API_TOKEN) {
        console.error('❌ BRIGHTDATA_API_TOKEN is missing. Skipping Facebook.');
      } else {
        scrapeTasks.push(
          scrapeFacebook(facebookUrls, outputDir, facebookBatchSize)
            .then(res => { finalSummary.facebook = res; })
        );
      }
    }
  }

  await Promise.all(scrapeTasks);

  // Write master summary
  const masterSummaryFile = path.join(outputDir, 'summary_all.json');
  fs.writeFileSync(masterSummaryFile, JSON.stringify(finalSummary, null, 2), 'utf8');

  console.log(`\n================================================================`);
  console.log(`🏆 ALL SCRAPING TASKS COMPLETED SUCCESSFULLY!`);
  console.log(`📁 Master Output Directory: ${outputDir}`);
  console.log(`📄 Master Summary:          ${masterSummaryFile}`);
  console.log(`================================================================\n`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Fatal error in export:', err);
    process.exit(1);
  });
}

module.exports = { main };
