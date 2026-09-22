const config = require('../src/config');
const googleSheet = require('../src/services/google-sheet');
const { normalizePhoneNumber, maskPhoneNumber } = require('../src/services/normalizer');

// Bộ nhớ đệm dữ liệu Sheet tạm thời trong memory để tối ưu tốc độ phản hồi (<200ms)
let cachedData = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30 * 1000; // 30 giây làm mới 1 lần

/**
 * Phân loại trạng thái bài thi dựa vào Cột Q:
 * 1. Duyệt / Hợp lệ -> APPROVED
 * 2. Vi phạm / Sai thể lệ / Loại / Hủy -> REJECTED
 * 3. Còn lại (trống hoặc ghi chú khác) -> PENDING (Đang duyệt)
 */
function classifyStatus(colQVal) {
  if (!colQVal || !String(colQVal).trim()) {
    return {
      status: 'PENDING',
      statusText: 'Đang duyệt',
      badgeClass: 'badge-pending',
      badgeColor: '#e6a23c', // Màu vàng cam
      note: 'Ban tổ chức đang kiểm tra'
    };
  }

  const raw = String(colQVal).trim();
  const s = raw.toLowerCase();

  // 1. Kiểm tra Vi phạm / Sai thể lệ / Từ chối / Không duyệt (Ưu tiên cao nhất)
  if (
    s.includes('vi phạm') ||
    s.includes('vi pham') ||
    s.includes('sai thể lệ') ||
    s.includes('sai the le') ||
    s.includes('không hợp lệ') ||
    s.includes('khong hop le') ||
    s.includes('không duyệt') ||
    s.includes('khong duyet') ||
    s.includes('từ chối') ||
    s.includes('tu choi') ||
    s.includes('loại') ||
    s.includes('loai') ||
    s.includes('hủy') ||
    s.includes('huy') ||
    s.includes('reject') ||
    s.includes('invalid') ||
    s.includes('disqualified')
  ) {
    return {
      status: 'REJECTED',
      statusText: 'Vi phạm thể lệ',
      badgeClass: 'badge-rejected',
      badgeColor: '#f56c6c', // Màu đỏ
      note: raw
    };
  }

  // 2. Kiểm tra Đang duyệt / Chờ duyệt / Chưa duyệt / Cần kiểm tra lại (Ưu tiên trước nhóm Duyệt)
  if (
    s.includes('đang duyệt') ||
    s.includes('dang duyet') ||
    s.includes('chờ duyệt') ||
    s.includes('cho duyet') ||
    s.includes('chưa duyệt') ||
    s.includes('chua duyet') ||
    s.includes('cần duyệt lại') ||
    s.includes('can duyet lai') ||
    s.includes('đang kiểm tra') ||
    s.includes('dang kiem tra') ||
    s.includes('chờ kiểm tra') ||
    s.includes('cho kiem tra') ||
    s.includes('pending')
  ) {
    return {
      status: 'PENDING',
      statusText: 'Đang duyệt',
      badgeClass: 'badge-pending',
      badgeColor: '#e6a23c', // Màu vàng cam
      note: raw || 'Ban tổ chức đang kiểm tra'
    };
  }

  // 3. Kiểm tra Duyệt / Hợp lệ / Đạt (Sau khi đã loại trừ các trường hợp phủ định/chờ ở trên)
  if (
    s.includes('đã duyệt') ||
    s.includes('da duyet') ||
    s.includes('hợp lệ') ||
    s.includes('hop le') ||
    s.includes('đạt') ||
    s.includes('dat') ||
    s.includes('ok') ||
    s.includes('pass') ||
    s.includes('approved') ||
    /(?:^|\s)duyệt(?:\s|$)/.test(s) ||
    /(?:^|\s)duyet(?:\s|$)/.test(s)
  ) {
    return {
      status: 'APPROVED',
      statusText: 'Đã duyệt',
      badgeClass: 'badge-approved',
      badgeColor: '#28a745', // Màu xanh lá
      note: raw || 'Hợp lệ'
    };
  }

  // 4. Mặc định còn lại: Tự động ghi là "Đang duyệt" kèm ghi chú gốc
  return {
    status: 'PENDING',
    statusText: 'Đang duyệt',
    badgeClass: 'badge-pending',
    badgeColor: '#e6a23c',
    note: raw || 'Ban tổ chức đang kiểm tra'
  };
}

async function getSheetRows() {
  const now = Date.now();
  if (cachedData && (now - lastCacheTime) < CACHE_TTL_MS) {
    return cachedData;
  }

  const sheets = googleSheet.getSheetsClient();
  const sourceSheetId = config.GOOGLE_SOURCE_SHEET_ID;
  const tabName = config.SOURCE_TAB_NAME || 'gop_du_lieu';
  const rangeQuery = `${tabName}!M:Q`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sourceSheetId,
    range: rangeQuery
  });

  const rows = res.data.values || [];
  cachedData = rows;
  lastCacheTime = now;
  return rows;
}

module.exports = async function handler(req, res) {
  // Cài đặt đầy đủ Headers CORS để chạy mượt 100% trên Zalo, Facebook, TikTok In-App Browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With, Accept, Content-Type, Cache-Control'
  );
  // Cho phép Edge Caching trên Vercel 30s để chống quá tải quota Google Sheets API
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Phương thức không hợp lệ (chỉ hỗ trợ GET)' });
  }

  try {
    // Trích xuất số điện thoại từ query param
    let rawPhone = '';
    if (req.query && req.query.phone) {
      rawPhone = String(req.query.phone);
    } else if (req.url && req.url.includes('?')) {
      const parsedUrl = new URL(req.url, 'http://localhost');
      rawPhone = parsedUrl.searchParams.get('phone') || '';
    }

    if (!rawPhone || !rawPhone.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Vui lòng nhập số điện thoại dự thi'
      });
    }

    const normPhone = normalizePhoneNumber(rawPhone);
    if (!normPhone || normPhone.length < 9 || normPhone.length > 11) {
      return res.status(400).json({
        success: false,
        error: 'Số điện thoại không đúng định dạng. Vui lòng nhập SĐT Việt Nam hợp lệ (ví dụ: 0912345678)'
      });
    }

    // Đọc danh sách bài thi từ Google Sheet
    const rows = await getSheetRows();
    if (rows.length <= 1) {
      return res.status(200).json({
        success: true,
        phoneMasked: maskPhoneNumber(normPhone),
        total: 0,
        videos: [],
        message: 'Chưa có dữ liệu bài thi trên hệ thống.'
      });
    }

    // Xác định vị trí các cột
    const headerRow = rows[0] || [];
    const headers = headerRow.map(h => String(h).toLowerCase().trim());

    let timestampIdx = headers.findIndex(h => h.includes('thời gian') || h.includes('time') || h.includes('ngày'));
    let phoneIdx = headers.findIndex(h => h.includes('sđt') || h.includes('điện thoại') || h.includes('phone'));
    let platformIdx = headers.findIndex(h => h.includes('nền tảng') || h.includes('platform'));
    let linkIdx = headers.findIndex(h => h.includes('link') || h.includes('bài thi') || h.includes('video'));
    let statusIdx = headers.findIndex(h => h.includes('thể lệ') || h.includes('trạng thái') || h.includes('duyệt') || h.includes('ghi chú'));

    // Gán mặc định theo thứ tự range M:Q nếu không có header khớp
    if (timestampIdx === -1) timestampIdx = 0; // Cột M
    if (phoneIdx === -1) phoneIdx = 1;         // Cột N
    if (platformIdx === -1) platformIdx = 2;   // Cột O
    if (linkIdx === -1) linkIdx = 3;           // Cột P
    if (statusIdx === -1) statusIdx = 4;       // Cột Q

    const matchedVideos = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;

      const rowRawPhone = r[phoneIdx] !== undefined ? String(r[phoneIdx]).trim() : '';
      const rowNormPhone = normalizePhoneNumber(rowRawPhone);

      if (rowNormPhone === normPhone) {
        const rawTime = r[timestampIdx] !== undefined ? String(r[timestampIdx]).trim() : '';
        const rawPlatform = r[platformIdx] !== undefined ? String(r[platformIdx]).trim() : '';
        let cleanLink = r[linkIdx] !== undefined ? String(r[linkIdx]).trim() : '';
        if (cleanLink && !/^https?:\/\//i.test(cleanLink)) {
          cleanLink = 'https://' + cleanLink;
        }
        const rawStatus = r[statusIdx] !== undefined ? String(r[statusIdx]).trim() : '';

        const classification = classifyStatus(rawStatus);

        matchedVideos.push({
          stt: matchedVideos.length + 1,
          submittedAt: rawTime || 'N/A',
          platform: rawPlatform || 'Video',
          link: cleanLink,
          status: classification.status,
          statusText: classification.statusText,
          badgeClass: classification.badgeClass,
          badgeColor: classification.badgeColor,
          note: classification.note
        });
      }
    }

    return res.status(200).json({
      success: true,
      phoneMasked: maskPhoneNumber(normPhone),
      total: matchedVideos.length,
      videos: matchedVideos,
      message: matchedVideos.length === 0 
        ? 'Chưa tìm thấy bài thi nào cho số điện thoại này. Bạn vui lòng kiểm tra lại SĐT hoặc gửi bài tại Form đăng ký.' 
        : `Tìm thấy ${matchedVideos.length} video dự thi của số điện thoại này.`
    });

  } catch (err) {
    console.error('[API Lookup Error]:', err);
    return res.status(500).json({
      success: false,
      error: 'Có lỗi xảy ra khi truy vấn dữ liệu. Vui lòng thử lại sau.'
    });
  }
};

module.exports.classifyStatus = classifyStatus;
