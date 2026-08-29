const crypto = require('crypto');
const { VIDEO_STATUS } = require('../config');

/**
 * Phân tích chuỗi số nghiêm ngặt, từ chối số âm, số thập phân, chuỗi chứa chữ, hoặc vượt MAX_SAFE_INTEGER
 * @param {any} val
 * @returns {number}
 */
function parseStrictNonNegativeInteger(val) {
  if (val === undefined || val === null || val === '') {
    throw new Error(`Invalid numeric value: ${val}`);
  }
  const strVal = String(val).trim();
  if (!/^(0|[1-9]\d*)$/.test(strVal)) {
    throw new Error(`Invalid numeric string format: ${strVal}`);
  }
  const num = Number(strVal);
  if (!Number.isSafeInteger(num)) {
    throw new Error(`Value exceeds MAX_SAFE_INTEGER: ${strVal}`);
  }
  if (num < 0) {
    throw new Error(`Negative numbers not allowed: ${num}`);
  }
  return num;
}

/**
 * Canonicalize data cho Public BXH để đảm bảo hash không bị lệch
 * @param {Array[]} rows Dữ liệu BXH
 * @returns {Array[]} Dữ liệu đã chuẩn hoá
 */
function canonicalizeAndValidatePublicRows(rows) {
  return rows.map((row, index) => {
    // row format: [rankBadge, user, view, comment, react]
    if (row.length < 5) {
      throw new Error(`Public row ${index} has missing columns`);
    }
    const rankBadge = String(row[0]).trim();
    const user = String(row[1]).trim();
    const view = parseStrictNonNegativeInteger(row[2]);
    const comment = parseStrictNonNegativeInteger(row[3]);
    const react = parseStrictNonNegativeInteger(row[4]);

    return [rankBadge, user, view, comment, react];
  });
}

/**
 * Tính hash SHA-256 dùng chung cho BXH
 * @param {Array[]} rows 
 * @returns {string} SHA-256 hex string
 */
function computeCanonicalPublicHash(rows) {
  const canonicalRows = canonicalizeAndValidatePublicRows(rows);
  const jsonStr = JSON.stringify(canonicalRows);
  return crypto.createHash('sha256').update(jsonStr).digest('hex');
}

/**
 * Phân tích và quản lý trạng thái LKG cho một video.
 * @param {object} existingLkg - Bản ghi LKG cũ từ sheet (nếu có)
 * @param {string} newStatus - Trạng thái cào mới (OK, TRANSIENT_ERROR, etc.)
 * @param {{view: number, react: number, comment: number}} newMetrics - Số liệu cào mới hoặc atomic fallback
 * @param {Date} now - Thời điểm hiện tại
 * @returns {object} Bản ghi LKG mới đã cập nhật
 */
function updateLkgRecord(existingLkg, newStatus, newMetrics, now = new Date()) {
  const nowIso = now.toISOString();

  // Terminal state: Daily run skip video RESET_APPROVED
  if (existingLkg && existingLkg.status === VIDEO_STATUS.RESET_APPROVED) {
    return { ...existingLkg, updated_at: nowIso };
  }

  if (!existingLkg) {
    // Chưa từng có LKG
    const isOk = newStatus === VIDEO_STATUS.OK;
    return {
      view: newMetrics.view || 0,
      react: newMetrics.react || 0,
      comment: newMetrics.comment || 0,
      status: newStatus,
      last_successful_at: isOk ? nowIso : '',
      consecutive_errors: isOk ? 0 : 1,
      first_error_at: isOk ? '' : nowIso,
      updated_at: nowIso
    };
  }

  if (newStatus === VIDEO_STATUS.OK) {
    return {
      view: newMetrics.view,
      react: newMetrics.react,
      comment: newMetrics.comment,
      status: VIDEO_STATUS.OK,
      last_successful_at: nowIso,
      consecutive_errors: 0,
      first_error_at: '',
      updated_at: nowIso
    };
  }

  // Gặp lỗi cào (Transient, Partial, Unavailable, Sensitive...)
  const consecutiveErrors = (Number(existingLkg.consecutive_errors) || 0) + 1;
  const firstErrorAt = existingLkg.first_error_at || nowIso;

  // Kiểm tra thời hạn ân hạn 72h (72 * 60 * 60 * 1000 ms)
  const firstErrorTime = new Date(firstErrorAt).getTime();
  const diffMs = now.getTime() - firstErrorTime;
  const isStale = diffMs >= 72 * 60 * 60 * 1000;

  let effectiveStatus = newStatus;
  
  // Vòng đời CONFIRMED_UNAVAILABLE -> STALE_EXPIRED
  if (newStatus === VIDEO_STATUS.CONFIRMED_UNAVAILABLE) {
    if (isStale) {
      effectiveStatus = VIDEO_STATUS.STALE_EXPIRED;
    }
  }

  // Nếu previously STALE_EXPIRED and scraper says CONFIRMED_UNAVAILABLE, keep STALE_EXPIRED
  if (existingLkg.status === VIDEO_STATUS.STALE_EXPIRED && newStatus === VIDEO_STATUS.CONFIRMED_UNAVAILABLE) {
      effectiveStatus = VIDEO_STATUS.STALE_EXPIRED;
  }

  return {
    view: existingLkg.view,
    react: existingLkg.react,
    comment: existingLkg.comment,
    status: effectiveStatus,
    last_successful_at: existingLkg.last_successful_at || '',
    consecutive_errors: consecutiveErrors,
    first_error_at: firstErrorAt,
    updated_at: nowIso
  };
}

module.exports = {
  parseStrictNonNegativeInteger,
  canonicalizeAndValidatePublicRows,
  computeCanonicalPublicHash,
  updateLkgRecord
};
