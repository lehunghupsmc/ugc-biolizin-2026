const fs = require('fs');
const path = require('path');
const { ApifyClient } = require('apify-client');
const config = require('../src/config');
const { getSheetsClient, readSourceFormSubmissions } = require('../src/services/google-sheet');

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = null;
  let batchSize = 60; // 50-75 URLs per Apify call for optimal reliability
  let inputFile = null;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--input=')) {
      inputFile = arg.split('=')[1];
    }
  }

  return { limit, batchSize, inputFile };
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

async function getTikTokUrls(inputFile) {
  if (inputFile && fs.existsSync(inputFile)) {
    console.log(`[TikTokExporter] 📂 Reading URLs from custom file: ${inputFile}`);
    let lines = [];
    if (inputFile.toLowerCase().endsWith('.xlsx')) {
      const { execSync } = require('child_process');
      const stdout = execSync(
        `python -c "import openpyxl; wb=openpyxl.load_workbook(r'''${inputFile}''', read_only=True); s=wb.active; urls=[str(c).strip() for row in s.iter_rows(values_only=True) for c in row if c and ('tiktok.com' in str(c) or str(c).startswith('http'))]; print('\\n'.join(urls))"`,
        { encoding: 'utf8' }
      );
      lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l && (l.includes('tiktok.com') || l.startsWith('http')));
    } else {
      const content = fs.readFileSync(inputFile, 'utf8');
      lines = content.split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && (l.includes('tiktok.com') || l.startsWith('http')));
    }
    return lines.map(url => ({ rawLink: url, rawPhone: '', rawName: '' }));
  }

  console.log(`[TikTokExporter] 📥 Fetching submissions from Google Sheet 'gop_du_lieu'...`);
  const sheets = getSheetsClient();
  const submissions = await readSourceFormSubmissions(sheets, config.GOOGLE_SOURCE_SHEET_ID);
  
  // Lọc các link thuộc nền tảng TikTok và không bị BTC đánh dấu loại
  const tiktokSubs = submissions.filter(s => {
    if (s.isDisqualified) return false;
    const link = (s.rawLink || '').toLowerCase();
    return link.includes('tiktok.com');
  });

  return tiktokSubs;
}

async function scrapeBatchWithApify(client, urls, batchIndex, totalBatches) {
  console.log(`\n[TikTokExporter] 🚀 [Batch ${batchIndex}/${totalBatches}] Triggering Apify for ${urls.length} URLs...`);
  const startTime = Date.now();

  const input = {
    postURLs: urls,
    commentsPerPost: 0,
    maxPostsPerQuery: urls.length
  };

  try {
    // Gọi actor clockworks/free-tiktok-scraper với timeout 10 phút mỗi batch
    const run = await client.actor('clockworks/free-tiktok-scraper').call(input, {
      timeout: 600,
      memory: 2048
    });

    console.log(`[TikTokExporter] ⏳ Actor run finished (ID: ${run.id}). Fetching dataset items...`);
    const { items } = await client.dataset(run.defaultDatasetId).listItems({
      limit: 1000
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[TikTokExporter] ✅ [Batch ${batchIndex}/${totalBatches}] Retrieved ${items.length} items from Apify in ${elapsed}s.`);
    return { ok: true, items, runId: run.id };
  } catch (err) {
    console.error(`[TikTokExporter] ❌ [Batch ${batchIndex}/${totalBatches}] Error during Apify run:`, err.message);
    return { ok: false, error: err.message, items: [] };
  }
}

async function main() {
  const { limit, batchSize, inputFile } = parseArgs();
  const token = config.APIFY_TOKEN;

  if (!token) {
    console.error('❌ APIFY_TOKEN is missing in environment variables. Please check .env file.');
    process.exit(1);
  }

  console.log('================================================================');
  console.log('🎬 TIKTOK RAW DATA EXPORTER (READ-ONLY & 100% RAW JSON OUTPUT)');
  console.log('================================================================');

  // 1. Lấy danh sách URL
  const allSubmissions = await getTikTokUrls(inputFile);
  console.log(`[TikTokExporter] Found ${allSubmissions.length} TikTok submissions.`);

  // 2. Deduplicate URLs (giữ lại thông tin thí sinh)
  const uniqueUrlMap = new Map();
  for (const sub of allSubmissions) {
    const cleanUrl = (sub.rawLink || '').trim();
    if (!cleanUrl) continue;
    if (!uniqueUrlMap.has(cleanUrl)) {
      uniqueUrlMap.set(cleanUrl, {
        url: cleanUrl,
        phones: sub.rawPhone ? [sub.rawPhone] : [],
        names: sub.rawName ? [sub.rawName] : []
      });
    } else {
      const existing = uniqueUrlMap.get(cleanUrl);
      if (sub.rawPhone && !existing.phones.includes(sub.rawPhone)) {
        existing.phones.push(sub.rawPhone);
      }
      if (sub.rawName && !existing.names.includes(sub.rawName)) {
        existing.names.push(sub.rawName);
      }
    }
  }

  let uniqueUrls = Array.from(uniqueUrlMap.values());
  console.log(`[TikTokExporter] Unique TikTok URLs to scrape: ${uniqueUrls.length}`);

  if (limit && limit > 0) {
    console.log(`[TikTokExporter] ⚠️ LIMIT APPLIED: Scraping only first ${limit} URLs for testing.`);
    uniqueUrls = uniqueUrls.slice(0, limit);
  }

  if (uniqueUrls.length === 0) {
    console.log('⚠️ No TikTok URLs to scrape. Exiting.');
    return;
  }

  // 3. Chuẩn bị thư mục Output
  const timestampStr = formatDateForFolder(new Date());
  const outputDir = path.join(process.cwd(), 'output', `tiktok_raw_${timestampStr}`);
  const itemsDir = path.join(outputDir, 'items');

  fs.mkdirSync(itemsDir, { recursive: true });
  console.log(`[TikTokExporter] 📁 Output directory: ${outputDir}`);

  // 4. Chia batch và cào qua Apify
  const client = new ApifyClient({ token });
  const rawUrlList = uniqueUrls.map(u => u.url);
  const batches = [];

  for (let i = 0; i < rawUrlList.length; i += batchSize) {
    batches.push(rawUrlList.slice(i, i + batchSize));
  }

  console.log(`[TikTokExporter] Splitting into ${batches.length} batch(es) (size ~${batchSize} URLs/batch)...`);

  const allScrapedItems = [];
  const batchRuns = [];

  for (let b = 0; b < batches.length; b++) {
    const batchUrls = batches[b];
    const res = await scrapeBatchWithApify(client, batchUrls, b + 1, batches.length);
    batchRuns.push({
      batch: b + 1,
      totalUrls: batchUrls.length,
      ok: res.ok,
      itemsCount: res.items.length,
      runId: res.runId || null,
      error: res.error || null
    });

    if (res.ok && res.items.length > 0) {
      allScrapedItems.push(...res.items);
    }

    // Khoảng nghỉ nhỏ 3s giữa các batch
    if (b < batches.length - 1) {
      console.log(`[TikTokExporter] Resting 3s before next batch...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n================================================================`);
  console.log(`📦 PROCESSING & SAVING JSON FILES...`);
  console.log(`================================================================`);

  // 5. Lưu từng item ra file riêng trong items/
  let savedFilesCount = 0;
  const itemIndex = [];

  for (let idx = 0; idx < allScrapedItems.length; idx++) {
    const item = allScrapedItems[idx];
    const videoId = String(item.id || item.videoId || `item_${idx + 1}`);
    const fileName = `${videoId}.json`;
    const filePath = path.join(itemsDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf8');
    savedFilesCount++;

    itemIndex.push({
      index: idx + 1,
      id: videoId,
      url: item.webVideoUrl || item.url || item.inputUrl || '',
      author: item.authorMeta?.name || item.authorMeta?.nickName || '',
      views: item.playCount ?? item.stats?.playCount ?? null,
      likes: item.diggCount ?? item.stats?.diggCount ?? null,
      comments: item.commentCount ?? item.stats?.commentCount ?? null,
      shares: item.shareCount ?? item.stats?.shareCount ?? null,
      file: `items/${fileName}`
    });
  }

  // 6. Lưu file JSON tổng hợp chứa toàn bộ items
  const allDataFile = path.join(outputDir, 'all_tiktok_data.json');
  fs.writeFileSync(allDataFile, JSON.stringify(allScrapedItems, null, 2), 'utf8');

  // 7. Tạo file mapping và summary
  const summary = {
    exported_at: new Date().toISOString(),
    total_unique_input_urls: uniqueUrls.length,
    total_batches: batches.length,
    total_items_scraped: allScrapedItems.length,
    total_individual_files_saved: savedFilesCount,
    batches: batchRuns,
    output_files: {
      all_data_json: allDataFile,
      items_directory: itemsDir,
      summary_json: path.join(outputDir, 'summary.json')
    }
  };

  const summaryFile = path.join(outputDir, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');

  // Lưu thêm file danh mục rút gọn kèm link file cho tiện tra cứu
  const indexFile = path.join(outputDir, 'index_overview.json');
  fs.writeFileSync(indexFile, JSON.stringify(itemIndex, null, 2), 'utf8');

  console.log(`\n🎉 HOÀN THÀNH XUẤT DỮ LIỆU TIKTOK!`);
  console.log(`----------------------------------------------------------------`);
  console.log(`- Tổng URL đầu vào:             ${uniqueUrls.length}`);
  console.log(`- Tổng số video cào được:       ${allScrapedItems.length}`);
  console.log(`- File JSON tổng:               ${allDataFile}`);
  console.log(`- Thư mục từng file video lẻ:   ${itemsDir}`);
  console.log(`- File tóm tắt summary:         ${summaryFile}`);
  console.log(`- File index tra cứu nhanh:     ${indexFile}`);
  console.log(`================================================================\n`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { main };
