const { ApifyClient } = require('apify-client');
const config = require('../config');

/**
 * Cào dữ liệu danh sách video TikTok thông qua Apify.
 * @param {Array<string>} videoUrls - Danh sách URL video TikTok
 * @returns {Promise<Map<string, {ok: boolean, data?: object, errorType?: string, errorMessage?: string}>>} Map[url -> result]
 */
async function scrapeTikTokBatch(videoUrls) {
  const results = new Map();
  if (!videoUrls || videoUrls.length === 0) {
    return results;
  }

  const token = config.APIFY_TOKEN;
  if (!token) {
    console.warn('[TikTokScraper] APIFY_TOKEN is not set. Marking items as TRANSIENT_ERROR / PENDING.');
    for (const url of videoUrls) {
      results.set(url, {
        ok: false,
        errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
        errorMessage: 'APIFY_TOKEN not configured'
      });
    }
    return results;
  }

  const client = new ApifyClient({ token });

  try {
    // Chạy Actor clockworks/free-tiktok-scraper
    const input = {
      postURLs: videoUrls,
      commentsPerPost: 0,
      maxPostsPerQuery: videoUrls.length
    };

    console.log(`[TikTokScraper] Triggering Apify actor for ${videoUrls.length} videos...`);
    const run = await client.actor('clockworks/free-tiktok-scraper').call(input, {
      timeoutSecs: 300
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    // Map kết quả theo video url hoặc video id
    for (const item of items) {
      const webVideoUrl = item.webVideoUrl || item.url || item.inputUrl || '';
      const id = String(item.id || '');

      // Tìm URL tương ứng trong danh sách videoUrls
      const matchedUrl = videoUrls.find(u => 
        (webVideoUrl && u.includes(webVideoUrl)) || 
        (id && u.includes(id)) || 
        (item.inputUrl && u === item.inputUrl)
      ) || webVideoUrl;

      if (matchedUrl) {
        if (item.error === 'POST_NOT_FOUND_OR_PRIVATE') {
          results.set(matchedUrl, {
            ok: false,
            errorType: config.VIDEO_STATUS.CONFIRMED_UNAVAILABLE,
            errorMessage: 'Video removed or set to private'
          });
        } else if (item.error === 'POST_SENSITIVE') {
          results.set(matchedUrl, {
            ok: false,
            errorType: config.VIDEO_STATUS.CONFIRMED_SENSITIVE,
            errorMessage: 'Video flagged as sensitive'
          });
        } else if (item.error) {
          results.set(matchedUrl, {
            ok: false,
            errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
            errorMessage: item.error
          });
        } else {
          results.set(matchedUrl, {
            ok: true,
            data: item
          });
        }
      }
    }

    // Các video không trả về kết quả
    for (const url of videoUrls) {
      if (!results.has(url)) {
        results.set(url, {
          ok: false,
          errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
          errorMessage: 'No data returned from Apify actor'
        });
      }
    }
  } catch (err) {
    console.error('[TikTokScraper] Apify batch scrape error:', err.message);
    // Bất kỳ lỗi HTTP 4xx, 5xx nào ở cấp batch đều là lỗi hạ tầng/network -> TRANSIENT_ERROR
    const errorType = config.VIDEO_STATUS.TRANSIENT_ERROR;

    for (const url of videoUrls) {
      if (!results.has(url)) {
        results.set(url, {
          ok: false,
          errorType,
          errorMessage: `Batch error: ${err.message}`
        });
      }
    }
  }

  return results;
}

module.exports = {
  scrapeTikTokBatch
};
