const config = require('../src/config');
const googleSheet = require('../src/services/google-sheet');
const { normalizePhoneNumber, maskPhoneNumber, parseSubmissionTimestamp } = require('../src/services/normalizer');
const { isRowApproved, parseMetric } = require('../src/manual-bxh');

async function previewBxh() {
  console.log(`[PreviewBXH] ==========================================`);
  console.log(`[PreviewBXH] 🔍 CHẾ ĐỘ XEM TRƯỚC BẢNG XẾP HẠNG (DRY-RUN)`);
  console.log(`[PreviewBXH] ⚠️ CHỈ HIỂN THỊ TẠI ĐÂY - TUYỆT ĐỐI KHÔNG GHI ĐÈ SHEET / KHÔNG ĐẨY ẢNH LÊN WEB`);
  console.log(`[PreviewBXH] Thời gian: ${new Date().toISOString()}`);
  console.log(`[PreviewBXH] ==========================================\n`);

  const sheets = googleSheet.getSheetsClient();
  const sourceSheetId = config.GOOGLE_SOURCE_SHEET_ID;
  const targetTab = config.SOURCE_TAB_NAME || 'Link bài thi';

  console.log(`[PreviewBXH] 📥 Đang tải dữ liệu từ Sheet ID: ${sourceSheetId} (Tab: '${targetTab}')...`);

  const range = `'${targetTab}'!A:Z`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sourceSheetId,
    range
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) {
    console.warn(`[PreviewBXH] ⚠️ Không có dữ liệu trong sheet '${targetTab}'.`);
    return;
  }

  console.log(`[PreviewBXH] Đã tải ${rows.length} dòng dữ liệu (bao gồm header).`);

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

  if (timeIdx === -1) timeIdx = 1;
  if (phoneIdx === -1) phoneIdx = 2;
  if (platformIdx === -1) platformIdx = 3;
  if (linkIdx === -1) linkIdx = 4;
  if (statusIdx === -1) statusIdx = 5;
  if (nameIdx === -1) nameIdx = 8;
  if (viewIdx === -1) viewIdx = 11;
  if (reactIdx === -1) reactIdx = 12;
  if (commentIdx === -1) commentIdx = 13;
  if (postIdIdx === -1) postIdIdx = 14;

  const bxhFallbackMap = new Map();
  try {
    const resBxh = await sheets.spreadsheets.values.get({
      spreadsheetId: sourceSheetId,
      range: "'BXH'!A:N"
    });
    const bxhRows = resBxh.data.values || [];
    for (let i = 1; i < bxhRows.length; i++) {
      const bxhRow = bxhRows[i];
      const link = bxhRow[4] ? String(bxhRow[4]).trim() : '';
      const status = bxhRow[5] ? String(bxhRow[5]).trim() : '';
      const view = bxhRow[11] ? parseMetric(bxhRow[11]) : 0;
      const react = bxhRow[12] ? parseMetric(bxhRow[12]) : 0;
      const comment = bxhRow[13] ? parseMetric(bxhRow[13]) : 0;
      const name = bxhRow[8] ? String(bxhRow[8]).trim() : '';
      if (link) {
        bxhFallbackMap.set(link, { status, view, react, comment, name });
      }
    }
  } catch (err) {
    console.warn(`[PreviewBXH] ⚠️ Không thể đọc tab 'BXH' dự phòng:`, err.message);
  }

  const rawApprovedRows = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;

    const rawLink = r[linkIdx] !== undefined ? String(r[linkIdx]).trim() : '';
    let rawStatus = r[statusIdx] !== undefined ? String(r[statusIdx]).trim() : '';

    const fallbackData = rawLink ? bxhFallbackMap.get(rawLink) : null;
    if ((!rawStatus || rawStatus.startsWith('#')) && fallbackData && fallbackData.status) {
      rawStatus = fallbackData.status;
    }

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
    let authorName = r[nameIdx] !== undefined ? String(r[nameIdx]).trim() : '';
    if ((!authorName || authorName.startsWith('MS4w') || authorName === 'FALSE') && fallbackData && fallbackData.name) {
      authorName = fallbackData.name;
    }
    let view = parseMetric(r[viewIdx]);
    let react = parseMetric(r[reactIdx]);
    let comment = parseMetric(r[commentIdx]);
    if (view === 0 && fallbackData && fallbackData.view) view = fallbackData.view;
    if (react === 0 && fallbackData && fallbackData.react) react = fallbackData.react;
    if (comment === 0 && fallbackData && fallbackData.comment) comment = fallbackData.comment;

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

  console.log(`[PreviewBXH] 📥 Đã tìm thấy ${rawApprovedRows.length} dòng có trạng thái Hợp lệ.`);

  // Sắp xếp FCFS
  rawApprovedRows.sort((a, b) => {
    if (a.parsedTime !== b.parsedTime) return a.parsedTime - b.parsedTime;
    return a.rowIndex - b.rowIndex;
  });

  // Lọc trùng theo Post ID
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
        continue;
      }
      seenPostKeys.set(postKey, item);
    }

    uniqueVideos.push(item);
  }

  // Gom nhóm theo SĐT
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
  console.log(`[PreviewBXH] 📊 Đã xử lý xong: ${rawApprovedRows.length} video hợp lệ -> Loại ${duplicateCount} video trùng Post ID -> Còn ${uniqueVideos.length} video duy nhất từ ${contestants.length} thí sinh độc lập.\n`);

  contestants.sort((a, b) => {
    if (b.totalView !== a.totalView) return b.totalView - a.totalView;
    const engA = a.totalReact + a.totalComment;
    const engB = b.totalReact + b.totalComment;
    if (engB !== engA) return engB - engA;
    return (a.primaryTimestamp || 0) - (b.primaryTimestamp || 0);
  });

  return {
    totalRows: rows.length,
    rawApprovedRows: rawApprovedRows.length,
    duplicateCount,
    uniqueVideos: uniqueVideos.length,
    totalContestants: contestants.length,
    top25: contestants.slice(0, 25)
  };
}

if (require.main === module) {
  previewBxh()
    .then((res) => {
      if (!res) return;
      console.log(`🏆 BẢNG XẾP HẠNG TOP 25 HIỆN TẠI (CHỈ XEM - KHÔNG PUBLISH):`);
      console.log(`-------------------------------------------------------------------------------------------------------`);
      console.log(`| Hạng | SĐT Thí Sinh | Tổng View | Bình Luận | Lượt Thích | Số Video | Tên Gợi Ý                     |`);
      console.log(`-------------------------------------------------------------------------------------------------------`);
      res.top25.forEach((c, idx) => {
        const rankBadge = idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : `${idx + 1}`;
        console.log(
          `| ${rankBadge.padEnd(4)} | ` +
          `${c.phoneMasked.padEnd(12)} | ` +
          `${c.totalView.toLocaleString('en-US').padStart(9)} | ` +
          `${c.totalComment.toLocaleString('en-US').padStart(9)} | ` +
          `${c.totalReact.toLocaleString('en-US').padStart(10)} | ` +
          `${String(c.videoCount).padStart(8)} | ` +
          `${c.name.slice(0, 29).padEnd(29)} |`
        );
      });
      console.log(`-------------------------------------------------------------------------------------------------------\n`);
      console.log(`[PreviewBXH] 🔒 BẢO LƯU: Toàn bộ dữ liệu web, file ảnh và Google Sheet Public được giữ nguyên 100%!`);
    })
    .catch((err) => {
      console.error(`[PreviewBXH] ❌ Lỗi:`, err);
    });
}

module.exports = { previewBxh };
