const https = require('https');
const http = require('http');
const config = require('../config');
const { ApifyTokenPool } = require('./apify-token-pool');

// Singleton token pool — tái sử dụng giữa các lần gọi
let _tokenPool = null;
function getTokenPool() {
  if (!_tokenPool) {
    _tokenPool = new ApifyTokenPool(config.APIFY_FB_TOKENS);
  }
  return _tokenPool;
}

// ─── URL Resolution & Video ID Extraction ───────────────────────────────────

/**
 * Trích xuất Video ID từ URL Facebook đã resolve.
 * Hỗ trợ: /reel/{id}, /videos/{id}, /watch/?v={id}, story_fbid={id}
 * @param {string} url
 * @returns {string|null}
 */
function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /\/reel\/(\d{8,})/i,
    /\/videos\/(?:[^/]+\/)?(\d{8,})/i,
    /[?&]v=(\d{8,})/i,
    /story_fbid=(\d{8,})/i,
    /\/watch\/?\?v=(\d{8,})/i
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Follow redirect cho Facebook share URL bằng native fetch.
 * @param {string} url
 * @returns {Promise<string>} URL đã resolve
 */
async function resolveShareUrl(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return res.url || url;
  } catch {
    return url;
  }
}

/**
 * Xây dựng mapping inputUrl ↔ videoId cho danh sách URLs.
 * Ưu tiên: (1) extract từ BD attachments/shortcode/post_url, (2) extract từ input URL, (3) resolve share URL qua fetch.
 * @param {Array<{inputUrl: string, bdItem: object|null}>} entries
 * @returns {Promise<Map<string, string>>} Map<inputUrl, videoId>
 */
async function buildVideoIdMap(entries) {
  const urlToVideoId = new Map();

  // Phase 1: Trích xuất nhanh từ BD data + input URL (không cần network)
  const needResolve = [];
  for (const { inputUrl, bdItem } of entries) {
    let videoId = null;
    if (bdItem) {
      const vidAttachment = bdItem.attachments?.find(a => a.type === 'video');
      videoId = vidAttachment?.id
        || (bdItem.post_type === 'Reel' ? bdItem.shortcode : null)
        || bdItem.shortcode
        || extractVideoId(bdItem.post_url || bdItem.url || '');
    }
    // Thử từ input URL
    if (!videoId) {
      videoId = extractVideoId(inputUrl);
    }

    if (videoId) {
      urlToVideoId.set(inputUrl, videoId);
    } else {
      needResolve.push(inputUrl);
    }
  }

  // Phase 2: Resolve share URLs song song (giới hạn concurrency = 10)
  if (needResolve.length > 0) {
    console.log(`[FacebookScraper] Resolving ${needResolve.length} share URLs để lấy Video ID...`);
    const CONCURRENCY = 10;
    for (let i = 0; i < needResolve.length; i += CONCURRENCY) {
      const batch = needResolve.slice(i, i + CONCURRENCY);
      const resolved = await Promise.all(batch.map(u => resolveShareUrl(u)));

      for (let j = 0; j < batch.length; j++) {
        const videoId = extractVideoId(resolved[j]);
        if (videoId) {
          urlToVideoId.set(batch[j], videoId);
        } else {
          console.warn(`[FacebookScraper] ⚠️ Không thể extract Video ID: ${batch[j]} (Resolved: ${resolved[j]})`);
        }
      }
    }
  }

  return urlToVideoId;
}

// ─── Bright Data API Calls ──────────────────────────────────────────────────

/**
 * Gửi request HTTPS đơn giản, trả về { statusCode, headers, body }.
 */
function httpsRequest(options, payload = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Trigger Bright Data dataset, poll đến khi ready, download snapshot.
 * @param {string[]} videoUrls
 * @param {string} token
 * @returns {Promise<object[]>} Mảng items từ Bright Data
 */
async function fetchBrightDataItems(videoUrls, token) {
  const datasetId = 'gd_lyclm1571iy3mv57zw';
  const payload = JSON.stringify(videoUrls.map(url => ({ url })));

  console.log(`[FacebookScraper] 1️⃣ Triggering Bright Data (${datasetId}) cho ${videoUrls.length} videos...`);

  // Trigger
  const triggerRes = await httpsRequest({
    hostname: 'api.brightdata.com',
    path: `/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 120000
  }, payload);

  if (triggerRes.statusCode < 200 || triggerRes.statusCode >= 300) {
    throw new Error(`Bright Data trigger failed (${triggerRes.statusCode}): ${triggerRes.body}`);
  }

  const { snapshot_id: snapshotId } = JSON.parse(triggerRes.body);
  if (!snapshotId) {
    throw new Error('No snapshot_id from Bright Data trigger');
  }

  // Poll
  console.log(`[FacebookScraper] 2️⃣ Polling snapshot: ${snapshotId}...`);
  const maxPollAttempts = 60; // 10 phút timeout

  for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 10000));

    try {
      const progressRes = await httpsRequest({
        hostname: 'api.brightdata.com',
        path: `/datasets/v3/progress/${snapshotId}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
      });

      if (progressRes.statusCode === 429) {
        const retryAfter = parseInt(progressRes.headers['retry-after'], 10) || 10;
        console.warn(`[FacebookScraper] HTTP 429. Backoff ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (progressRes.statusCode !== 200) {
        throw new Error(`Progress API returned ${progressRes.statusCode}: ${progressRes.body}`);
      }

      const progress = JSON.parse(progressRes.body);
      if (progress.status === 'failed') {
        throw new Error(`Snapshot failed: ${progress.message || 'unknown'}`);
      }
      if (progress.status === 'ready') {
        console.log(`[FacebookScraper] Snapshot ready! (poll #${attempt + 1})`);
        break;
      }
      // Log progress mỗi 30s (mỗi 3 lần poll)
      if (attempt % 3 === 0) {
        console.log(`[FacebookScraper]   ... status: ${progress.status} (poll #${attempt + 1}/${maxPollAttempts})`);
      }
      if (attempt === maxPollAttempts - 1) {
        throw new Error('Bright Data scraping timed out (10 minutes)');
      }
    } catch (err) {
      if (attempt === maxPollAttempts - 1) throw err;
      console.warn(`[FacebookScraper] Poll error: ${err.message}. Retrying...`);
    }
  }

  // Download snapshot
  console.log(`[FacebookScraper] 3️⃣ Downloading snapshot data...`);
  const snapshotRes = await httpsRequest({
    hostname: 'api.brightdata.com',
    path: `/datasets/v3/snapshot/${snapshotId}?format=json`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    timeout: 30000
  });

  if (snapshotRes.statusCode !== 200) {
    throw new Error(`Snapshot download failed (${snapshotRes.statusCode})`);
  }

  return JSON.parse(snapshotRes.body);
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

/**
 * Pipeline Hybrid: Bright Data (metadata) + Apify (play_count backfill).
 *
 * Flow:
 *   1. Bright Data → likes, comments, shares, author, profile_id
 *   2. Kiểm tra items thiếu play_count
 *   3. Resolve URLs → Video IDs
 *   4. Apify TokenPool → play_count
 *   5. Merge play_count vào BD results
 *
 * @param {Array<string>} videoUrls
 * @returns {Promise<Map<string, {ok: boolean, data?: object, errorType?: string, errorMessage?: string}>>}
 */
async function scrapeFacebookBatch(videoUrls) {
  const results = new Map();
  if (!videoUrls || videoUrls.length === 0) {
    return results;
  }

  const bdToken = config.BRIGHTDATA_API_TOKEN;
  if (!bdToken) {
    console.warn('[FacebookScraper] BRIGHTDATA_API_TOKEN not set. Marking all as TRANSIENT_ERROR.');
    for (const url of videoUrls) {
      results.set(url, {
        ok: false,
        errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
        errorMessage: 'BRIGHTDATA_API_TOKEN not configured'
      });
    }
    return results;
  }

  let bdItems = [];
  try {
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: Bright Data — Metadata (likes, comments, shares, author)
    // ═══════════════════════════════════════════════════════════════════════
    bdItems = await fetchBrightDataItems(videoUrls, bdToken);
    console.log(`[FacebookScraper] Bright Data trả về ${bdItems.length} items.`);
  } catch (err) {
    console.error('[FacebookScraper] ❌ Bright Data error:', err.message);
    for (const url of videoUrls) {
      results.set(url, {
        ok: false,
        errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
        errorMessage: err.message
      });
    }
    return results;
  }

  // Map BD items theo input URL
  const bdByUrl = new Map();
  for (const item of bdItems) {
    const inputUrl = item.input?.url || item.url || '';
    if (inputUrl) bdByUrl.set(inputUrl, item);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2: Xác định items thiếu play_count → cần Apify backfill
  // ═══════════════════════════════════════════════════════════════════════
  const needBackfill = []; // { inputUrl, bdItem }
  let alreadyHasPlayCount = 0;

  for (const url of videoUrls) {
    const bdItem = bdByUrl.get(url);
    if (!bdItem || bdItem.error || bdItem.status === 'error') continue;

    const pc = bdItem.play_count;
    if (pc !== null && pc !== undefined && !isNaN(Number(pc)) && Number(pc) > 0) {
      alreadyHasPlayCount++;
    } else {
      needBackfill.push({ inputUrl: url, bdItem });
    }
  }

  console.log(`[FacebookScraper] Play_count: ${alreadyHasPlayCount} có sẵn | ${needBackfill.length} cần backfill.`);

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 3: Resolve URLs → Video IDs → Apify play_count backfill
  // ═══════════════════════════════════════════════════════════════════════
  if (needBackfill.length > 0) {
    const pool = getTokenPool();

    if (pool.hasTokens) {
      // Build URL → VideoID mapping
      const urlToVideoId = await buildVideoIdMap(needBackfill);

      // Tạo danh sách reel URLs cho Apify
      const reelUrls = [];
      const videoIdToInputUrl = new Map(); // Reverse map để merge kết quả

      for (const { inputUrl } of needBackfill) {
        const videoId = urlToVideoId.get(inputUrl);
        if (videoId) {
          const reelUrl = `https://www.facebook.com/reel/${videoId}`;
          reelUrls.push(reelUrl);
          videoIdToInputUrl.set(videoId, inputUrl);
        }
      }

      if (reelUrls.length > 0) {
        console.log(`[FacebookScraper] 4️⃣ Apify backfill cho ${reelUrls.length} videos...`);

        const { results: playCounts, failedUrls } = await pool.scrapePlayCounts(reelUrls);

        // Merge play_count vào BD items
        let mergedCount = 0;
        for (const [videoId, playCount] of playCounts) {
          const inputUrl = videoIdToInputUrl.get(videoId);
          if (inputUrl) {
            const bdItem = bdByUrl.get(inputUrl);
            if (bdItem) {
              bdItem.play_count = playCount;
              mergedCount++;
            }
          }
        }

        console.log(`[FacebookScraper] 5️⃣ Merged ${mergedCount} play_counts vào BD data.`);
        if (failedUrls.length > 0) {
          console.warn(`[FacebookScraper] ⚠️ ${failedUrls.length} URLs không lấy được play_count.`);
        }
      }
    } else {
      console.warn('[FacebookScraper] APIFY_FB_TOKENS trống. Bỏ qua play_count backfill.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 4: Map kết quả cuối cùng
  // ═══════════════════════════════════════════════════════════════════════
  for (const item of bdItems) {
    const inputUrl = item.input?.url || item.url || '';
    if (!inputUrl) continue;

    if (item.error || item.status === 'error') {
      results.set(inputUrl, {
        ok: false,
        errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
        errorMessage: item.error || 'Bright Data item error'
      });
    } else {
      results.set(inputUrl, {
        ok: true,
        data: item
      });
    }
  }

  // URLs không có trong BD results
  for (const url of videoUrls) {
    if (!results.has(url)) {
      results.set(url, {
        ok: false,
        errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
        errorMessage: 'No data returned for Facebook video'
      });
    }
  }

  return results;
}

module.exports = {
  scrapeFacebookBatch,
  // Export cho testing
  extractVideoId,
  resolveShareUrl,
  buildVideoIdMap
};
