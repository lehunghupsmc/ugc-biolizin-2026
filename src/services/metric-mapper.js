const { VIDEO_STATUS } = require('../config');

/**
 * Kiểm tra và chuẩn hóa giá trị số liệu nghiêm ngặt.
 * Chỉ chấp nhận số nguyên không âm an toàn (Safe Integer).
 * Từ chối: null, undefined, NaN, chuỗi rút gọn "1.2K", số có dấu phẩy "12,345", số âm.
 * @param {any} value
 * @returns {number|null} Số nguyên hợp lệ hoặc null nếu không hợp lệ
 */
function validateStrictInteger(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Chỉ chấp nhận chuỗi thuần chữ số (VD: "12345")
    if (/^\d+$/.test(trimmed)) {
      const parsed = parseInt(trimmed, 10);
      if (Number.isSafeInteger(parsed) && parsed >= 0) {
        return parsed;
      }
    }
    return null;
  }

  return null;
}

/**
 * Trích xuất và ánh xạ các trường từ TikTok (Apify item response).
 * @param {object} item
 * @returns {{view: number|null, react: number|null, comment: number|null, share: number|null}}
 */
function mapTikTokMetrics(item) {
  if (!item || typeof item !== 'object') {
    return { view: null, react: null, comment: null, share: null };
  }

  const rawView = item.playCount ?? item.stats?.playCount ?? item.statsV2?.playCount;
  const rawReact = item.diggCount ?? item.stats?.diggCount ?? item.statsV2?.diggCount;
  const rawComment = item.commentCount ?? item.stats?.commentCount ?? item.statsV2?.commentCount;
  const rawShare = item.shareCount ?? item.stats?.shareCount ?? item.statsV2?.shareCount;

  return {
    view: validateStrictInteger(rawView),
    react: validateStrictInteger(rawReact),
    comment: validateStrictInteger(rawComment),
    share: validateStrictInteger(rawShare)
  };
}

/**
 * Trích xuất và ánh xạ các trường từ Facebook (Bright Data item response).
 * @param {object} item
 * @returns {{view: number|null, react: number|null, comment: number|null, share: number|null}}
 */
function mapFacebookMetrics(item) {
  if (!item || typeof item !== 'object') {
    return { view: null, react: null, comment: null, share: null };
  }

  const rawView = item.play_count ?? item.video_view_count ?? item.views;

  // Tính react: ưu tiên likes, hoặc tổng các loại reaction nếu có mảng
  let rawReact = item.likes ?? item.reactions_count;
  if (rawReact === undefined && Array.isArray(item.num_likes_type)) {
    rawReact = item.num_likes_type.reduce((acc, curr) => acc + (Number(curr?.num) || 0), 0);
  }

  const rawComment = item.num_comments ?? item.comments_count ?? item.comments;
  const rawShare = item.num_shares ?? item.shares_count ?? item.shares;

  return {
    view: validateStrictInteger(rawView),
    react: validateStrictInteger(rawReact),
    comment: validateStrictInteger(rawComment),
    share: validateStrictInteger(rawShare)
  };
}

/**
 * Áp dụng Per-Video Atomic Snapshot và LKG Fallback Engine.
 * Nếu bất kỳ chỉ số nào bị thiếu/lỗi, giữ toàn bộ số liệu LKG cũ của video đó.
 * @param {'tiktok'|'facebook'} platform
 * @param {object} rawScrapedItem
 * @param {{view: number, react: number, comment: number}|null} lkgMetrics
 * @param {string|null} scrapeError
 * @returns {{status: string, metrics: {view: number, react: number, comment: number}, usedLkg: boolean, errorDetails?: string}}
 */
function applyAtomicSnapshot(platform, rawScrapedItem, lkgMetrics = null, scrapeError = null) {
  // Nếu scraper báo lỗi xác nhận
  if (scrapeError) {
    if (lkgMetrics) {
      return {
        status: scrapeError,
        metrics: { ...lkgMetrics },
        usedLkg: true,
        errorDetails: `Scraper error (${scrapeError}), kept LKG snapshot`
      };
    }
    // Batch errors (TRANSIENT) without LKG go to PENDING_RETRY. Item errors without LKG keep their status.
    const finalStatus = scrapeError === VIDEO_STATUS.TRANSIENT_ERROR ? VIDEO_STATUS.PENDING_RETRY : scrapeError;
    return {
      status: finalStatus,
      metrics: { view: 0, react: 0, comment: 0 },
      usedLkg: false,
      errorDetails: `Scraper error (${scrapeError}), no LKG available`
    };
  }

  let mapped;
  if (platform === 'tiktok') {
    mapped = mapTikTokMetrics(rawScrapedItem);
  } else if (platform === 'facebook') {
    mapped = mapFacebookMetrics(rawScrapedItem);
  } else {
    mapped = { view: null, react: null, comment: null };
  }

  // Kiểm tra tính hợp lệ của cả 3 chỉ số chính
  const isViewValid = mapped.view !== null;
  const isReactValid = mapped.react !== null;
  const isCommentValid = mapped.comment !== null;

  if (isViewValid && isReactValid && isCommentValid) {
    return {
      status: VIDEO_STATUS.OK,
      metrics: {
        view: mapped.view,
        react: mapped.react,
        comment: mapped.comment
      },
      usedLkg: false
    };
  }

  // Bị lỗi partial field
  const invalidFields = [];
  if (!isViewValid) invalidFields.push('view');
  if (!isReactValid) invalidFields.push('react');
  if (!isCommentValid) invalidFields.push('comment');

  if (lkgMetrics) {
    return {
      status: VIDEO_STATUS.PARTIAL_FIELD_ERROR,
      metrics: { ...lkgMetrics },
      usedLkg: true,
      errorDetails: `Invalid fields: [${invalidFields.join(', ')}]. Kept atomic LKG.`
    };
  }

  return {
    status: VIDEO_STATUS.PENDING_RETRY,
    metrics: { view: 0, react: 0, comment: 0 },
    usedLkg: false,
    errorDetails: `Invalid fields: [${invalidFields.join(', ')}]. No LKG available.`
  };
}

module.exports = {
  validateStrictInteger,
  mapTikTokMetrics,
  mapFacebookMetrics,
  applyAtomicSnapshot
};
