/**
 * Chuẩn hóa số điện thoại về chuẩn 10 chữ số Quốc gia Việt Nam (0xxxxxxxxx).
 * Xử lý các đầu số +84, 84, khoảng trắng, dấu chấm, gạch ngang.
 * @param {string|number} rawPhone
 * @returns {string|null} Số điện thoại chuẩn 10 số (bắt đầu bằng 0) hoặc null nếu không hợp lệ
 */
function normalizePhoneNumber(rawPhone) {
  if (rawPhone === undefined || rawPhone === null) return null;
  let str = String(rawPhone).trim();

  // Bỏ mọi ký tự không phải số hoặc dấu +
  str = str.replace(/[^\d+]/g, '');

  if (str.startsWith('+84')) {
    str = '0' + str.slice(3);
  } else if (str.startsWith('84') && str.length === 11) {
    str = '0' + str.slice(2);
  } else if (str.length === 9 && /^[35789]/.test(str)) {
    str = '0' + str;
  }

  // Xóa mọi dấu + còn lại
  str = str.replace(/\+/g, '');

  // Kiểm tra định dạng số điện thoại Việt Nam 10 chữ số (bắt đầu bằng 0)
  if (/^0\d{9}$/.test(str)) {
    return str;
  }

  return null;
}

/**
 * Mask số điện thoại hiển thị trên BXH công khai (VD: 091***678).
 * @param {string} phone
 * @returns {string}
 */
function maskPhoneNumber(phone) {
  if (!phone) return '000***000';
  const clean = String(phone).trim();
  if (clean.length === 10) {
    return `${clean.slice(0, 3)}***${clean.slice(7)}`;
  }
  if (clean.length > 6) {
    return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
  }
  return `${clean.slice(0, 2)}***`;
}

/**
 * Tạo Composite Key định danh duy nhất cho từng video.
 * @param {'tiktok'|'facebook'} platform
 * @param {string} canonicalVideoId
 * @returns {string} Ví dụ: tiktok:7525806036511444232
 */
function createCompositeKey(platform, canonicalVideoId) {
  if (!platform || !canonicalVideoId) {
    throw new Error('Platform and canonicalVideoId are required to build CompositeKey');
  }
  const cleanPlatform = String(platform).toLowerCase().trim();
  const cleanId = String(canonicalVideoId).trim();
  return `${cleanPlatform}:${cleanId}`;
}

/**
 * Phân tách Composite Key thành platform và canonicalVideoId.
 * @param {string} compositeKey
 * @returns {{platform: string, videoId: string}}
 */
function parseCompositeKey(compositeKey) {
  if (!compositeKey || typeof compositeKey !== 'string') {
    return { platform: '', videoId: '' };
  }
  const idx = compositeKey.indexOf(':');
  if (idx === -1) {
    return { platform: 'unknown', videoId: compositeKey };
  }
  return {
    platform: compositeKey.substring(0, idx).toLowerCase(),
    videoId: compositeKey.substring(idx + 1)
  };
}

/**
 * Parse timestamp gửi từ Google Form. Hỗ trợ định dạng VN (DD/MM/YYYY HH:mm:ss), ISO.
 * Ép về múi giờ +07:00 nếu không có timezone.
 * @param {string} rawStr
 * @returns {number|null} Timestamp dạng ms hoặc null nếu không hợp lệ
 */
function parseSubmissionTimestamp(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return null;
  const s = rawStr.trim();
  if (!s) return null;

  // Nếu là chuỗi ISO hợp lệ có chữ T hoặc Z
  if (s.includes('T') || s.includes('Z')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.getTime();
  }

  // Regex bắt DD/MM/YYYY HH:mm:ss hoặc DD/MM/YYYY
  const vnRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?$/;
  const vnMatch = s.match(vnRegex);
  if (vnMatch) {
    const [_, d, m, y, h, min, sec] = vnMatch;
    // Format YYYY-MM-DDTHH:mm:ss+07:00
    const hh = (h || '00').padStart(2, '0');
    const mm = (min || '00').padStart(2, '0');
    const ss = (sec || '00').padStart(2, '0');
    const isoStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh}:${mm}:${ss}+07:00`;
    const dt = new Date(isoStr);
    if (!isNaN(dt.getTime())) return dt.getTime();
  }

  // Regex bắt YYYY-MM-DD HH:mm:ss
  const dashRegex = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?$/;
  const dashMatch = s.match(dashRegex);
  if (dashMatch) {
    const [_, y, m, d, h, min, sec] = dashMatch;
    const hh = (h || '00').padStart(2, '0');
    const mm = (min || '00').padStart(2, '0');
    const ss = (sec || '00').padStart(2, '0');
    const isoStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh}:${mm}:${ss}+07:00`;
    const dt = new Date(isoStr);
    if (!isNaN(dt.getTime())) return dt.getTime();
  }

  // Fallback native
  const dtNative = new Date(s);
  if (!isNaN(dtNative.getTime())) return dtNative.getTime();

  return null;
}


module.exports = {
  normalizePhoneNumber,
  maskPhoneNumber,
  createCompositeKey,
  parseCompositeKey,
  parseSubmissionTimestamp
};
