const fs = require('fs');
const path = require('path');
const config = require('./config');
const googleSheet = require('./services/google-sheet');
const { normalizePhoneNumber, maskPhoneNumber, parseSubmissionTimestamp } = require('./services/normalizer');
const { generateLeaderboardImage } = require('./services/image-generator');

/**
 * Kiểm tra trạng thái dòng xem có đạt chuẩn "Hợp lệ" hay không
 */
function isRowApproved(rawStatus) {
  if (!rawStatus) return false;
  const s = String(rawStatus).toLowerCase().trim();

  // Loại trừ các trường hợp phủ định hoặc vi phạm
  if (
    s.includes('không') ||
    s.includes('khong') ||
    s.includes('vi phạm') ||
    s.includes('vi pham') ||
    s.includes('sai thể lệ') ||
    s.includes('sai the le') ||
    s.includes('loại') ||
    s.includes('loai') ||
    s.includes('hủy') ||
    s.includes('huy') ||
    s.includes('reject') ||
    s.includes('invalid')
  ) {
    return false;
  }

  return (
    s.includes('hợp lệ') ||
    s.includes('hop le') ||
    s.includes('đã duyệt') ||
    s.includes('da duyet') ||
    s.includes('approved') ||
    /(?:^|\b|\s)đạt(?:\b|\s|$)/.test(s) ||
    /(?:^|\b|\s)ok(?:\b|\s|$)/.test(s) ||
    /(?:^|\b|\s)pass(?:\b|\s|$)/.test(s)
  );
}

/**
 * Chuyển đổi an toàn chuỗi chỉ số sang số nguyên
 */
function parseMetric(val) {
  if (val === undefined || val === null) return 0;
  const str = String(val).trim().replace(/[^\d]/g, '');
  return Number(str) || 0;
}

/**
 * Phân tích tham số từ dòng lệnh (CLI args)
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let syncSheet = false;
  let fileName = 'bxh-top20.jpg';
  let top = 20;

  for (const arg of args) {
    if (arg === '--sync-sheet' || arg === '--sync') {
      syncSheet = true;
    } else if (arg.startsWith('--file-name=')) {
      fileName = arg.split('=')[1];
    } else if (arg.startsWith('--top=')) {
      top = parseInt(arg.split('=')[1], 10) || 20;
    }
  }

  return { syncSheet, fileName, top };
}

/**
 * Xử lý dữ liệu bán thủ công từ sheet 'Link bài thi' và tính BXH
 */
async function processManualBxh(options = {}) {
  const syncSheet = options.syncSheet ?? false;
  const fileName = options.fileName || 'bxh-top20.jpg';
  const top = options.top || 20;

  console.log(`[ManualBXH] ==========================================`);
  console.log(`[ManualBXH] 🚀 Khởi chạy Module BXH Bán Thủ Công (Phương án 2)`);
  console.log(`[ManualBXH] Thời gian: ${new Date().toISOString()}`);
  console.log(`[ManualBXH] Ghi đè file ảnh: ${fileName} | Đồng bộ Sheet: ${syncSheet ? 'CÓ' : 'KHÔNG'}`);
  console.log(`[ManualBXH] ==========================================`);

  let sheets;
  try {
    sheets = googleSheet.getSheetsClient();
    console.log(`[ManualBXH] ✅ Kết nối Google Sheets API thành công.`);
  } catch (err) {
    console.error(`[ManualBXH] ❌ Lỗi kết nối Google Sheets:`, err.message);
    throw err;
  }

  const sourceSheetId = config.GOOGLE_SOURCE_SHEET_ID;
  const publicSheetId = config.GOOGLE_PUBLIC_SHEET_ID;
  const targetTab = config.SOURCE_TAB_NAME || 'Link bài thi';

  console.log(`[ManualBXH] 📥 Đang tải dữ liệu từ Sheet ID: ${sourceSheetId} (Tab: '${targetTab}')...`);

  // Đọc từ cột A đến Z để đảm bảo không bị sót cột Post ID mới thêm
  const range = `'${targetTab}'!A:Z`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sourceSheetId,
    range
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) {
    console.warn(`[ManualBXH] ⚠️ Không có dữ liệu trong sheet '${targetTab}'.`);
    return { success: false, totalRows: 0, validRows: 0, totalContestants: 0 };
  }

  console.log(`[ManualBXH] Đã tải ${rows.length} dòng dữ liệu (bao gồm header).`);

  // Phân tích header để định vị cột tự động
  const headerRow = rows[0] || [];
  const headers = headerRow.map(h => String(h).toLowerCase().trim());

  let timeIdx = headers.findIndex(h => h.includes('thời gian') || h.includes('time') || h.includes('ngày nộp'));
  let phoneIdx = headers.findIndex(h => h.includes('sđt') || h.includes('điện thoại') || h.includes('phone'));
  let platformIdx = headers.findIndex(h => h.includes('nền tảng') || h.includes('platform'));
  let linkIdx = headers.findIndex(h => h.includes('link') || h.includes('bài thi') || h.includes('url'));
  let statusIdx = headers.findIndex(h => h.includes('nhãn check') || h.includes('nhan check') || h.includes('trạng thái') || h.includes('duyệt'));
  let nameIdx = headers.findIndex(h => (h.includes('tên') || h.includes('name')) && !h.includes('profile'));
  if (nameIdx === -1) {
    nameIdx = headers.findIndex(h => h.includes('profile'));
  }
  let viewIdx = headers.findIndex(h => h.includes('view') || h.includes('lượt xem'));
  let reactIdx = headers.findIndex(h => h.includes('react') || h.includes('tym') || h.includes('thích'));
  let commentIdx = headers.findIndex(h => h.includes('comment') || h.includes('bình luận'));
  let postIdIdx = headers.findIndex(h => h.includes('post id') || h.includes('postid') || h.includes('post_id') || h.includes('id bài') || h.includes('id video'));

  // Fallback về chỉ mục mặc định của sheet 'Link bài thi' nếu không tìm thấy header
  if (timeIdx === -1) timeIdx = 1;     // Cột B: Thời gian
  if (phoneIdx === -1) phoneIdx = 2;    // Cột C: SĐT
  if (platformIdx === -1) platformIdx = 3;// Cột D: Nền tảng
  if (linkIdx === -1) linkIdx = 4;      // Cột E: Link bài thi
  if (statusIdx === -1) statusIdx = 5;  // Cột F: Nhãn check
  if (nameIdx === -1) nameIdx = 8;      // Cột I: Tên
  if (viewIdx === -1) viewIdx = 11;     // Cột L: View
  if (reactIdx === -1) reactIdx = 12;   // Cột M: React
  if (commentIdx === -1) commentIdx = 13;// Cột N: Comment
  if (postIdIdx === -1) postIdIdx = 14; // Cột O: Post id

  console.log(`[ManualBXH] 📌 Cấu hình cột: SĐT [Cột ${phoneIdx + 1}], Nhãn [Cột ${statusIdx + 1}], Post ID [Cột ${postIdIdx + 1}], View [Cột ${viewIdx + 1}], React [Cột ${reactIdx + 1}], Comment [Cột ${commentIdx + 1}]`);

  // BƯỚC 1: LỌC TOÀN BỘ CÁC DÒNG HỢP LỆ VÀO MẢNG TẠM
  const rawApprovedRows = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;

    const rawStatus = r[statusIdx] !== undefined ? String(r[statusIdx]).trim() : '';
    if (!isRowApproved(rawStatus)) {
      continue;
    }

    const rawPhone = r[phoneIdx] !== undefined ? String(r[phoneIdx]).trim() : '';
    const normPhone = normalizePhoneNumber(rawPhone);
    if (!normPhone) {
      continue;
    }

    const rawTime = r[timeIdx] !== undefined ? String(r[timeIdx]).trim() : '';
    const parsedTime = parseSubmissionTimestamp(rawTime) || 0;
    const platform = r[platformIdx] !== undefined ? String(r[platformIdx]).trim() : '';
    const rawLink = r[linkIdx] !== undefined ? String(r[linkIdx]).trim() : '';
    const authorName = r[nameIdx] !== undefined ? String(r[nameIdx]).trim() : '';
    const view = parseMetric(r[viewIdx]);
    const react = parseMetric(r[reactIdx]);
    const comment = parseMetric(r[commentIdx]);
    const postId = (postIdIdx !== -1 && r[postIdIdx] !== undefined) ? String(r[postIdIdx]).trim() : '';

    rawApprovedRows.push({
      rowIndex: i + 1,
      phone: normPhone,
      rawPhone,
      platform,
      rawLink,
      authorName,
      view,
      react,
      comment,
      postId,
      parsedTime
    });
  }

  console.log(`[ManualBXH] 📥 Đã tìm thấy ${rawApprovedRows.length} dòng có trạng thái Hợp lệ.`);

  // BƯỚC 2: SẮP XẾP THEO FIRST-COME FIRST-SERVED (FCFS) ĐỂ BẢO VỆ QUYỀN NỘP TRƯỚC
  rawApprovedRows.sort((a, b) => {
    if (a.parsedTime !== b.parsedTime) return a.parsedTime - b.parsedTime;
    return a.rowIndex - b.rowIndex;
  });

  // BƯỚC 3: LỌC TRÙNG THEO POST ID (HOẶC URL NẾU KHÔNG CÓ POST ID)
  const seenPostKeys = new Map();
  const uniqueVideos = [];
  let duplicateCount = 0;

  for (const item of rawApprovedRows) {
    let postKey = '';
    if (item.postId) {
      const p = item.platform.toLowerCase();
      const normP = (p.includes('tiktok') || item.rawLink.includes('tiktok')) ? 'tiktok' : (p.includes('facebook') || p.includes('fb') || item.rawLink.includes('facebook') || item.rawLink.includes('fb.watch')) ? 'fb' : 'post';
      postKey = `${normP}:${item.postId}`;
    } else if (item.rawLink) {
      postKey = item.rawLink.trim();
    }

    if (postKey) {
      if (seenPostKeys.has(postKey)) {
        duplicateCount++;
        const firstEntry = seenPostKeys.get(postKey);
        console.log(`[ManualBXH] ⚠️ Bỏ qua video trùng Post ID [${item.postId || postKey}] ở dòng ${item.rowIndex} (SĐT: ${item.phone}). Video này đã được nộp trước ở dòng ${firstEntry.rowIndex} (SĐT: ${firstEntry.phone}).`);
        continue;
      }
      seenPostKeys.set(postKey, item);
    }

    uniqueVideos.push(item);
  }

  // BƯỚC 4: GOM NHÓM & CỘNG DỒN CHỈ SỐ THEO TỪNG THÍ SINH (THEO SĐT ĐÃ CHUẨN HÓA)
  const contestantsMap = new Map();

  for (const v of uniqueVideos) {
    if (!contestantsMap.has(v.phone)) {
      contestantsMap.set(v.phone, {
        phone: v.phone,
        phoneMasked: maskPhoneNumber(v.phone),
        name: v.authorName || 'Thí sinh',
        totalView: 0,
        totalReact: 0,
        totalComment: 0,
        videoCount: 0,
        primaryTimestamp: v.parsedTime
      });
    }

    const contestant = contestantsMap.get(v.phone);
    if (v.authorName && contestant.name === 'Thí sinh') {
      contestant.name = v.authorName;
    }

    contestant.totalView += v.view;
    contestant.totalReact += v.react;
    contestant.totalComment += v.comment;
    contestant.videoCount += 1;

    if (!contestant.primaryTimestamp || (v.parsedTime && v.parsedTime < contestant.primaryTimestamp)) {
      contestant.primaryTimestamp = v.parsedTime;
    }
  }

  const contestants = Array.from(contestantsMap.values());
  console.log(`[ManualBXH] 📊 Đã xử lý xong: ${rawApprovedRows.length} video hợp lệ ban đầu -> Loại ${duplicateCount} video trùng Post ID -> Còn ${uniqueVideos.length} video duy nhất từ ${contestants.length} thí sinh độc lập.`);

  // BƯỚC 5: SẮP XẾP THỨ HẠNG THEO QUY TẮC CHUẨN CỦA CUỘC THI:
  // 1. Tổng View giảm dần
  // 2. Tổng Tương tác (React + Comment) giảm dần
  // 3. Thời gian nộp video đầu tiên sớm hơn đứng trước
  contestants.sort((a, b) => {
    if (b.totalView !== a.totalView) return b.totalView - a.totalView;
    const engA = a.totalReact + a.totalComment;
    const engB = b.totalReact + b.totalComment;
    if (engB !== engA) return engB - engA;
    return (a.primaryTimestamp || 0) - (b.primaryTimestamp || 0);
  });

  // Tạo định dạng hàng cho Sheet Public và Console
  const publicBxhRows = [];
  contestants.forEach((c, index) => {
    const rankNum = index + 1;
    let rankBadge = `${rankNum}`;
    if (rankNum === 1) rankBadge = '🥇 1';
    else if (rankNum === 2) rankBadge = '🥈 2';
    else if (rankNum === 3) rankBadge = '🥉 3';

    publicBxhRows.push([
      rankBadge,
      c.phoneMasked,
      c.totalView,
      c.totalComment,
      c.totalReact
    ]);
  });

  // In bảng tóm tắt Top 20 ra màn hình Console
  console.log(`\n🏆 BẢNG XẾP HẠNG TOP 20 (ĐÃ LỌC TRÙNG POST ID):`);
  console.log(`----------------------------------------------------------------------------------`);
  console.log(`| Hạng | SĐT Thí Sinh | Tổng View | Bình Luận | Lượt Thích | Số Video | Tên Gợi Ý |`);
  console.log(`----------------------------------------------------------------------------------`);
  contestants.slice(0, 20).forEach((c, idx) => {
    const rankBadge = idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : `${idx + 1}`;
    console.log(
      `| ${rankBadge.padEnd(4)} | ` +
      `${c.phoneMasked.padEnd(12)} | ` +
      `${c.totalView.toLocaleString('en-US').padStart(9)} | ` +
      `${c.totalComment.toLocaleString('en-US').padStart(9)} | ` +
      `${c.totalReact.toLocaleString('en-US').padStart(10)} | ` +
      `${String(c.videoCount).padStart(8)} | ` +
      `${c.name.slice(0, 15).padEnd(15)} |`
    );
  });
  console.log(`----------------------------------------------------------------------------------\n`);

  // 1. Sinh ảnh BXH Top 20 (ghi đè bxh-top20.jpg hoặc theo tên chỉ định)
  console.log(`[ManualBXH] 🖼️ Đang sinh ảnh BXH Top 20 vào file: public/${fileName}...`);
  const imageResult = await generateLeaderboardImage(contestants.slice(0, top), {
    fileName
  });
  console.log(`[ManualBXH] ✅ Đã tạo ảnh thành công: ${imageResult.outputPath} (${imageResult.width}x${imageResult.height}px)`);

  // 2. Tùy chọn: Đồng bộ sang Google Sheet Public tab 'BXH'
  if (syncSheet) {
    console.log(`[ManualBXH] 📤 Đang ghi đồng bộ ${publicBxhRows.length} dòng sang Sheet Public (${publicSheetId})...`);
    await googleSheet.writePhase2Public(sheets, publicSheetId, publicBxhRows);
    console.log(`[ManualBXH] ✅ Đồng bộ Sheet Public thành công!`);
  }

  return {
    success: true,
    totalRows: rows.length,
    rawApprovedRows: rawApprovedRows.length,
    duplicateCount,
    validVideos: uniqueVideos.length,
    totalContestants: contestants.length,
    top20: contestants.slice(0, 20),
    imagePath: imageResult.outputPath
  };
}

// Chạy trực tiếp nếu gọi từ CLI
if (require.main === module) {
  const args = parseArgs();
  processManualBxh(args)
    .then(() => {
      console.log(`[ManualBXH] 🎉 Hoàn tất thành công!`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[ManualBXH] ❌ Thất bại:`, err);
      process.exit(1);
    });
}

module.exports = {
  processManualBxh,
  isRowApproved,
  parseMetric
};
