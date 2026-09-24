const { ApifyClient } = require('apify-client');

const ACTOR_ID = 'social_developer/facebook-playcount-scraper';
const CHUNK_SIZE = 50;

/**
 * Pool xoay vòng Apify token cho Facebook play_count scraper.
 * Khi 1 token hết quota (402), tự động chuyển sang token tiếp theo.
 */
class ApifyTokenPool {
  /**
   * @param {string[]} tokens - Danh sách Apify API tokens
   */
  constructor(tokens) {
    this.tokens = tokens;
    this.currentIndex = 0;
    this.exhaustedSet = new Set();
  }

  get hasTokens() {
    return this.tokens.length > 0;
  }

  get availableCount() {
    return this.tokens.length - this.exhaustedSet.size;
  }

  /**
   * Kiểm tra lỗi có phải do hết quota hay không.
   * Apify trả 402 Payment Required khi hết credit.
   */
  _isQuotaError(err) {
    if (!err) return false;
    const msg = (err.message || '').toLowerCase();
    const statusCode = err.statusCode || err.status || 0;
    return (
      statusCode === 402 ||
      msg.includes('payment required') ||
      msg.includes('insufficient') ||
      msg.includes('usage limit') ||
      msg.includes('credit') ||
      msg.includes('quota')
    );
  }

  /**
   * Lấy token khả dụng tiếp theo (bỏ qua token đã hết quota).
   * @returns {string|null}
   */
  _nextAvailableToken() {
    for (let i = 0; i < this.tokens.length; i++) {
      const idx = (this.currentIndex + i) % this.tokens.length;
      if (!this.exhaustedSet.has(idx)) {
        this.currentIndex = idx;
        return this.tokens[idx];
      }
    }
    return null;
  }

  /**
   * Cào play_count cho danh sách Facebook reel URLs.
   * Chia batch thành chunks, xoay token khi hết quota.
   *
   * @param {string[]} reelUrls - Danh sách URL dạng https://facebook.com/reel/{id}
   * @returns {Promise<{results: Map<string, number>, failedUrls: string[]}>}
   *   results: Map<videoId, playCount>
   *   failedUrls: URLs không lấy được play_count
   */
  async scrapePlayCounts(reelUrls) {
    const results = new Map(); // videoId -> play_count
    let remaining = [...reelUrls];

    if (!this.hasTokens) {
      console.warn('[ApifyTokenPool] Không có APIFY_FB_TOKENS. Bỏ qua play_count backfill.');
      return { results, failedUrls: remaining };
    }

    console.log(`[ApifyTokenPool] Bắt đầu cào play_count cho ${remaining.length} URLs với ${this.availableCount} tokens khả dụng...`);

    while (remaining.length > 0) {
      const token = this._nextAvailableToken();
      if (!token) {
        console.error(`[ApifyTokenPool] ❌ Tất cả ${this.tokens.length} tokens đã hết quota!`);
        break;
      }

      const tokenLabel = `Token ${this.currentIndex + 1}/${this.tokens.length}`;
      const chunk = remaining.slice(0, CHUNK_SIZE);

      try {
        console.log(`[ApifyTokenPool] [${tokenLabel}] Gửi chunk ${chunk.length} URLs...`);

        const client = new ApifyClient({ token });
        const run = await client.actor(ACTOR_ID).call({
          startUrls: chunk.map(url => ({ url }))
        }, {
          timeout: 120 // 2 phút timeout
        });

        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        let successCount = 0;
        const processedUrls = new Set();

        for (const item of items) {
          const videoId = String(item.video_id || '');
          const playCount = item.play_count;

          if (videoId && playCount !== null && playCount !== undefined && (item.status === 'ok' || item.status === 'success')) {
            results.set(videoId, Number(playCount));
            successCount++;
          }

          // Track URL đã xử lý (dù success hay fail)
          if (item.url) processedUrls.add(item.url);
        }

        console.log(`[ApifyTokenPool] [${tokenLabel}] ✅ ${successCount}/${chunk.length} URLs thành công.`);

        // Xóa chunk đã xử lý khỏi remaining
        remaining = remaining.slice(chunk.length);

      } catch (err) {
        if (this._isQuotaError(err)) {
          console.warn(`[ApifyTokenPool] [${tokenLabel}] ⚠️ Hết quota! Chuyển sang token tiếp theo...`);
          this.exhaustedSet.add(this.currentIndex);
          this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
          // Không xóa chunk khỏi remaining → retry với token mới
          continue;
        }

        // Lỗi khác (network, actor crash, ...) → log và skip chunk
        console.error(`[ApifyTokenPool] [${tokenLabel}] ❌ Lỗi: ${err.message}`);
        remaining = remaining.slice(chunk.length); // Skip chunk lỗi
      }
    }

    console.log(`[ApifyTokenPool] Hoàn tất: ${results.size} play_counts | ${remaining.length} URLs thất bại.`);
    return { results, failedUrls: remaining };
  }
}

module.exports = { ApifyTokenPool };
