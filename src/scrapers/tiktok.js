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

  const tokens = config.APIFY_TIKTOK_TOKENS && config.APIFY_TIKTOK_TOKENS.length > 0
    ? config.APIFY_TIKTOK_TOKENS
    : (config.APIFY_TOKEN ? [config.APIFY_TOKEN] : []);

  if (tokens.length === 0) {
    console.warn('[TikTokScraper] Không có token Apify nào được cấu hình cho TikTok.');
    for (const url of videoUrls) {
      results.set(url, {
        ok: false,
        errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
        errorMessage: 'APIFY_TOKEN not configured'
      });
    }
    return results;
  }

  let lastError = null;

  for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
    const currentToken = tokens[tIdx];
    const client = new ApifyClient({ token: currentToken });

    try {
      const input = {
        postURLs: videoUrls,
        commentsPerPost: 0,
        maxPostsPerQuery: videoUrls.length
      };

      console.log(`[TikTokScraper] [Token ${tIdx + 1}/${tokens.length}] Triggering Apify actor for ${videoUrls.length} videos...`);
      const run = await client.actor('clockworks/free-tiktok-scraper').call(input);

      const { items } = await client.dataset(run.defaultDatasetId).listItems();

      // Map kết quả theo video url hoặc video id
      for (const item of items) {
        const webVideoUrl = item.webVideoUrl || item.url || item.inputUrl || '';
        const id = String(item.id || '');

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

      for (const url of videoUrls) {
        if (!results.has(url)) {
          results.set(url, {
            ok: false,
            errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
            errorMessage: 'No data returned from Apify actor'
          });
        }
      }

      // Đã cào thành công bằng token này, thoát loop
      return results;

    } catch (err) {
      lastError = err;
      const isQuota = err.statusCode === 402 || 
                      (err.message && (err.message.includes('402') || err.message.toLowerCase().includes('quota') || err.message.toLowerCase().includes('credit')));
      
      console.warn(`[TikTokScraper] [Token ${tIdx + 1}/${tokens.length}] Lỗi: ${err.message}`);
      if (isQuota && tIdx < tokens.length - 1) {
        console.warn(`[TikTokScraper] Hết quota token ${tIdx + 1}, tự động chuyển sang token tiếp theo...`);
        continue;
      }
      break;
    }
  }

  // Nếu tất cả token đều lỗi
  console.error('[TikTokScraper] Tất cả token Apify TikTok đều thất bại:', lastError?.message);
  for (const url of videoUrls) {
    if (!results.has(url)) {
      results.set(url, {
        ok: false,
        errorType: config.VIDEO_STATUS.TRANSIENT_ERROR,
        errorMessage: `Batch error: ${lastError?.message || 'Unknown error'}`
      });
    }
  }

  return results;
}

module.exports = {
  scrapeTikTokBatch
};
