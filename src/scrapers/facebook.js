const https = require('https');
const config = require('../config');

/**
 * Gọi Bright Data Web Scraper API để cào dữ liệu danh sách Facebook Reels / Videos.
 * @param {Array<string>} videoUrls
 * @returns {Promise<Map<string, {ok: boolean, data?: object, errorType?: string, errorMessage?: string}>>} Map[url -> result]
 */
async function scrapeFacebookBatch(videoUrls) {
  const results = new Map();
  if (!videoUrls || videoUrls.length === 0) {
    return results;
  }

  const token = config.BRIGHTDATA_API_TOKEN;
  if (!token) {
    console.warn('[FacebookScraper] BRIGHTDATA_API_TOKEN is not set. Marking items as TRANSIENT_ERROR / PENDING.');
    for (const url of videoUrls) {
      results.set(url, {
        ok: false,
        errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
        errorMessage: 'BRIGHTDATA_API_TOKEN not configured'
      });
    }
    return results;
  }

  try {
    // Chuẩn bị payload gửi tới Bright Data Dataset Trigger
    const datasetId = 'gd_lyclm1571iy3mv57zw'; // Bright Data Facebook Posts / Reels Scraper
    const payload = JSON.stringify(videoUrls.map(url => ({ url })));

    console.log(`[FacebookScraper] Triggering Bright Data dataset (${datasetId}) for ${videoUrls.length} videos...`);

    const responseData = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.brightdata.com',
        path: `/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 120000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Failed to parse Bright Data trigger response: ${body}`));
            }
          } else {
            reject(new Error(`Bright Data API responded with status ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Bright Data request timed out'));
      });

      req.write(payload);
      req.end();
    });

    const snapshotId = responseData.snapshot_id;
    if (!snapshotId) {
      throw new Error('No snapshot_id received from Bright Data trigger');
    }

    console.log(`[FacebookScraper] Polling Bright Data snapshot: ${snapshotId}...`);

    let isReady = false;
    let items = [];
    const maxPollAttempts = 30;
    
    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      await new Promise(r => setTimeout(r, 10000)); // Chờ 10s giữa mỗi lần poll

      try {
        const progressRes = await new Promise((resolve, reject) => {
          const req = https.request({
            hostname: 'api.brightdata.com',
            path: `/datasets/v3/progress/${snapshotId}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 10000
          }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
              resolve({ statusCode: res.statusCode, headers: res.headers, body });
            });
          });
          req.on('error', reject);
          req.end();
        });

        if (progressRes.statusCode === 429) {
          const retryAfter = parseInt(progressRes.headers['retry-after'], 10) || 10;
          console.warn(`[FacebookScraper] HTTP 429 Too Many Requests. Backoff for ${retryAfter}s...`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          continue;
        }

        if (progressRes.statusCode !== 200) {
          throw new Error(`Progress API returned ${progressRes.statusCode}: ${progressRes.body}`);
        }

        const progressData = JSON.parse(progressRes.body);
        if (progressData.status === 'failed') {
          throw new Error(`Bright Data snapshot failed: ${progressData.message || 'unknown error'}`);
        }

        if (progressData.status === 'ready') {
          isReady = true;
          break;
        }
        
        // starting, running -> continue polling
      } catch (err) {
        console.warn(`[FacebookScraper] Poll progress error: ${err.message}. Retrying...`);
      }
    }

    if (!isReady) {
      throw new Error('Bright Data scraping timed out after 5 minutes');
    }

    // Download snapshot data
    const snapshotRes = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.brightdata.com',
        path: `/datasets/v3/snapshot/${snapshotId}?format=json`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 30000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      req.on('error', reject);
      req.end();
    });

    if (snapshotRes.statusCode === 200) {
      items = JSON.parse(snapshotRes.body);
    } else {
      throw new Error(`Failed to download snapshot, status ${snapshotRes.statusCode}`);
    }

    // Map kết quả
    for (const item of items) {
      const inputUrl = item.input?.url || item.url || '';
      if (inputUrl) {
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
    }

    for (const url of videoUrls) {
      if (!results.has(url)) {
        results.set(url, {
          ok: false,
          errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
          errorMessage: 'No data returned for Facebook video'
        });
      }
    }
  } catch (err) {
    console.error('[FacebookScraper] Bright Data scrape error:', err.message);
    for (const url of videoUrls) {
      if (!results.has(url)) {
        results.set(url, {
          ok: false,
          errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
          errorMessage: err.message
        });
      }
    }
  }

  return results;
}

module.exports = {
  scrapeFacebookBatch
};
