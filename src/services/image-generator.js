const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// 20 toạ độ tâm trục Y tương ứng với 20 hàng trên phôi ảnh (đã hiệu chuẩn thực tế)
const ROW_CENTERS_Y = [
  439, 563, 686, 806, 909, 1034, 1158, 1308, 1433, 1558,
  1683, 1808, 1931, 2050, 2180, 2304, 2402, 2553, 2678, 2776
];

const COLUMNS_X = {
  USER: { x: 544, anchor: 'middle', maxWidthChars: 25 },
  VIEW: { x: 980, anchor: 'middle' },
  COMMENT: { x: 1236, anchor: 'middle' },
  TYM: { x: 1478, anchor: 'middle' }
};

const THEME_COLOR = '#5e3592';
const FONT_STACK = "'Segoe UI', 'Open Sans', 'Nunito', Arial, Helvetica, sans-serif";

/**
 * Escape ký tự đặc biệt cho SVG XML
 */
function escapeSvg(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Định dạng số nguyên có dấu phẩy phân cách hàng nghìn (vd: 125000 -> 125,000)
 */
function formatNumber(num) {
  const n = Number(num) || 0;
  return n.toLocaleString('en-US');
}

/**
 * Cắt ngắn chuỗi nếu quá dài để không bị lẹm sang cột View
 */
function truncateText(text, maxChars = 27) {
  if (!text) return '';
  const s = String(text).trim();
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 2) + '...';
}

/**
 * Chuẩn hóa input thí sinh thành object đồng nhất
 */
function normalizeContestantItem(item) {
  if (Array.isArray(item)) {
    // Định dạng mảng: [rankBadge, userDisplay, totalView, totalComment, totalReact]
    return {
      user: item[1] || '098***...',
      view: formatNumber(item[2]),
      comment: formatNumber(item[3]),
      tym: formatNumber(item[4])
    };
  }

  // Định dạng object: ưu tiên phoneMasked (SĐT 098***123)
  const user = item.phoneMasked || item.userDisplay || (item.name ? `${item.name}` : '098***...');
  return {
    user: user || '098***...',
    view: formatNumber(item.totalView ?? item.view),
    comment: formatNumber(item.totalComment ?? item.comment),
    tym: formatNumber(item.totalReact ?? item.tym ?? item.react)
  };
}

/**
 * Tạo lớp phủ SVG chứa dữ liệu text Top 20
 */
function buildLeaderboardSvg(contestants) {
  const rowsSvg = [];

  for (let i = 0; i < Math.min(contestants.length, 20); i++) {
    const yCenter = ROW_CENTERS_Y[i];
    const data = normalizeContestantItem(contestants[i]);
    const userDisplay = truncateText(data.user, COLUMNS_X.USER.maxWidthChars);

    rowsSvg.push(`
      <text x="${COLUMNS_X.USER.x}" y="${yCenter}" font-family="${FONT_STACK}" font-size="34" font-weight="bold" dominant-baseline="middle" text-anchor="${COLUMNS_X.USER.anchor}" fill="${THEME_COLOR}">${escapeSvg(userDisplay)}</text>
      <text x="${COLUMNS_X.VIEW.x}" y="${yCenter}" font-family="${FONT_STACK}" font-size="34" font-weight="bold" dominant-baseline="middle" text-anchor="${COLUMNS_X.VIEW.anchor}" fill="${THEME_COLOR}">${escapeSvg(data.view)}</text>
      <text x="${COLUMNS_X.COMMENT.x}" y="${yCenter}" font-family="${FONT_STACK}" font-size="34" font-weight="bold" dominant-baseline="middle" text-anchor="${COLUMNS_X.COMMENT.anchor}" fill="${THEME_COLOR}">${escapeSvg(data.comment)}</text>
      <text x="${COLUMNS_X.TYM.x}" y="${yCenter}" font-family="${FONT_STACK}" font-size="34" font-weight="bold" dominant-baseline="middle" text-anchor="${COLUMNS_X.TYM.anchor}" fill="${THEME_COLOR}">${escapeSvg(data.tym)}</text>
    `);
  }

  return Buffer.from(`
    <svg width="1676" height="2921" xmlns="http://www.w3.org/2000/svg">
      ${rowsSvg.join('\n')}
    </svg>
  `);
}

/**
 * Sinh ảnh Bảng Xếp Hạng Top 20 và lưu vào đường dẫn chỉ định
 * @param {Array<object|Array>} contestants - Danh sách thí sinh Top 20
 * @param {object} options - Cấu hình tuỳ chọn (outputDir, fileName, templatePath, quality)
 * @returns {Promise<{outputPath: string, width: number, height: number, totalRendered: number}>}
 */
async function generateLeaderboardImage(contestants = [], options = {}) {
  const rootDir = process.cwd();
  const templatePath = options.templatePath || path.join(rootDir, 'assets', 'bxh-template.jpg');
  const outputDir = options.outputDir || path.join(rootDir, 'public');
  const fileName = options.fileName || 'bxh-top20.jpg';
  const outputPath = path.join(outputDir, fileName);
  const quality = options.quality || 90;

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Leaderboard template image not found at: ${templatePath}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`[ImageGenerator] Rendering Top ${Math.min(contestants.length, 20)} leaderboard onto template...`);

  const svgOverlay = buildLeaderboardSvg(contestants);

  await sharp(templatePath)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .jpeg({ quality, mozjpeg: true })
    .toFile(outputPath);

  console.log(`[ImageGenerator] ✅ Successfully generated leaderboard image: ${outputPath}`);

  return {
    outputPath,
    width: 1676,
    height: 2921,
    totalRendered: Math.min(contestants.length, 20)
  };
}

module.exports = {
  generateLeaderboardImage,
  buildLeaderboardSvg,
  ROW_CENTERS_Y,
  COLUMNS_X
};
