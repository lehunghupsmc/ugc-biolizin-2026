const { google } = require('googleapis');
const config = require('../config');

/**
 * Khởi tạo Google Sheets API client từ Service Account.
 */
function getSheetsClient() {
  const credentials = config.getServiceAccountCredentials();
  if (!credentials) {
    throw new Error('Google Service Account credentials not found. Please provide ugc-biolizin-key.json or GOOGLE_SERVICE_ACCOUNT_KEY.');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Lấy metadata (bao gồm numeric sheetId, rowCount) của tất cả tab
 */
async function getSheetMeta(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const meta = {};
  for (const sheet of res.data.sheets) {
    meta[sheet.properties.title] = sheet;
  }
  return meta;
}

/**
 * Đảm bảo 7 tab Internal bắt buộc đều tồn tại trong Sheet 2.
 */
async function ensureInternalTabsExist(sheets, spreadsheetId) {
  const meta = await getSheetMeta(sheets, spreadsheetId);
  const existingTabs = Object.keys(meta);
  const requiredTabs = [
    config.TABS.INTERNAL_LKG,
    config.TABS.INTERNAL_CHI_TIET,
    config.TABS.INTERNAL_CANH_BAO,
    config.TABS.INTERNAL_PREPARED,
    config.TABS.INTERNAL_RUN_HISTORY,
    config.TABS.INTERNAL_APPROVAL_AUDIT,
    config.TABS.INTERNAL_SYSTEM_META
  ];

  const missingTabs = requiredTabs.filter(tab => !existingTabs.includes(tab));

  if (missingTabs.length > 0) {
    console.log(`[GoogleSheet] Creating missing Internal tabs: ${missingTabs.join(', ')}`);
    const requests = missingTabs.map(title => ({
      addSheet: { properties: { title } }
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });

    const headerUpdates = [];

    if (missingTabs.includes(config.TABS.INTERNAL_LKG)) {
      headerUpdates.push({
        range: `${config.TABS.INTERNAL_LKG}!A1:M1`,
        values: [['composite_key', 'platform', 'canonical_video_id', 'phone', 'user_name', 'view', 'react', 'comment', 'status', 'last_successful_at', 'consecutive_errors', 'first_error_at', 'updated_at']]
      });
    }

    if (missingTabs.includes(config.TABS.INTERNAL_CHI_TIET)) {
      headerUpdates.push({
        range: `${config.TABS.INTERNAL_CHI_TIET}!A1:N1`,
        values: [['composite_key', 'platform', 'user_name', 'phone_raw', 'phone_masked', 'link_raw', 'canonical_url', 'status', 'view', 'react', 'comment', 'is_lkg', 'error_details', 'updated_at']]
      });
    }

    if (missingTabs.includes(config.TABS.INTERNAL_CANH_BAO)) {
      headerUpdates.push({
        range: `${config.TABS.INTERNAL_CANH_BAO}!A1:G1`,
        values: [['type', 'composite_key', 'user_name', 'phone_masked', 'link_raw', 'message', 'detected_at']]
      });
    }

    if (missingTabs.includes(config.TABS.INTERNAL_PREPARED)) {
      headerUpdates.push({
        range: `${config.TABS.INTERNAL_PREPARED}!A1:H1`,
        values: [['rank', 'user_display', 'phone_masked', 'total_view', 'total_comment', 'total_react', 'video_count', 'primary_timestamp']]
      });
    }

    if (missingTabs.includes(config.TABS.INTERNAL_RUN_HISTORY)) {
      headerUpdates.push({
        range: `${config.TABS.INTERNAL_RUN_HISTORY}!A1:L1`,
        values: [['run_id', 'started_at', 'completed_at', 'action', 'total_videos', 'ok', 'transient', 'permanent', 'pending', 'payload_hash', 'run_status', 'published_at']]
      });
    }
    
    if (missingTabs.includes(config.TABS.INTERNAL_APPROVAL_AUDIT)) {
      headerUpdates.push({
        range: `${config.TABS.INTERNAL_APPROVAL_AUDIT}!A1:F1`,
        values: [['approved_at', 'action_type', 'actor', 'approval_reason', 'payload', 'system_state_hash']]
      });
    }

    if (missingTabs.includes(config.TABS.INTERNAL_SYSTEM_META)) {
      headerUpdates.push({
        range: `${config.TABS.INTERNAL_SYSTEM_META}!A1:B9`,
        values: [
          ['Key', 'Value'],
          ['CONTEST_STATUS', config.CONTEST_STATUS.ACTIVE],
          ['CONTEST_END_AT', config.CONTEST_END_AT],
          ['FROZEN_AT', ''],
          ['FROZEN_BY', ''],
          ['RUN_STATUS', config.RUN_STATUS.IDLE],
          ['PREPARED_RUN_ID', ''],
          ['PREPARED_AT', ''],
          ['PREPARED_PAYLOAD_HASH', '']
        ]
      });
    }

    if (headerUpdates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: headerUpdates
        }
      });
    }
  }
}

function isDisqualifiedStatus(statusStr) {
  if (!statusStr) return false;
  const s = String(statusStr).toLowerCase().trim();
  return (
    s.includes('sai thể lệ') ||
    s.includes('sai the le') ||
    s.includes('không hợp lệ') ||
    s.includes('khong hop le') ||
    s.includes('loại') ||
    s.includes('loai') ||
    s.includes('hủy') ||
    s.includes('huy') ||
    s.includes('vi phạm') ||
    s.includes('vi pham') ||
    s.includes('disqualif') ||
    s.includes('reject') ||
    s.includes('invalid') ||
    s.includes('spam')
  );
}

/**
 * Đọc dữ liệu từ Sheet Nguồn (mặc định tab 'gop_du_lieu' range M:Q).
 */
async function readSourceFormSubmissions(sheets, spreadsheetId) {
  const meta = await getSheetMeta(sheets, spreadsheetId);
  const existingTabs = Object.keys(meta);
  
  const targetTabName = config.SOURCE_TAB_NAME || 'gop_du_lieu';
  const targetRange = config.SOURCE_RANGE || 'M:Q';

  // 1. Ưu tiên tìm tab 'gop_du_lieu' (không phân biệt hoa thường)
  let formTab = existingTabs.find(t => t.trim().toLowerCase() === targetTabName.toLowerCase());
  if (!formTab) {
    formTab = existingTabs.find(t => t.toLowerCase().includes('gop') || t.toLowerCase().includes('du_lieu')) || existingTabs[0] || 'Sheet1';
  }

  const rangeQuery = `${formTab}!${targetRange}`;
  console.log(`[GoogleSheet] Reading source submissions from: ${rangeQuery}`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeQuery
  });

  const rows = res.data.values || [];
  if (rows.length === 0) return [];

  // Tự động phân tích các cột trong range
  const headerRow = rows[0] || [];
  const headers = headerRow.map(h => String(h).toLowerCase().trim());

  let timestampIdx = headers.findIndex(h => h.includes('thời gian') || h.includes('timestamp') || h.includes('date') || h.includes('ngày') || h.includes('thoi_gian'));
  let phoneIdx = headers.findIndex(h => h.includes('sđt') || h.includes('số điện thoại') || h.includes('điện thoại') || h.includes('phone') || h.includes('so_dien_thoai'));
  let canonicalLinkIdx = headers.findIndex(h => h.includes('link chuẩn') || h.includes('link bung') || h.includes('link thật'));
  let linkIdx = headers.findIndex(h => h.includes('link_bai_thi') || h.includes('bài thi') || h.includes('dự thi') || h.includes('link') || h.includes('video') || h.includes('liên kết') || h.includes('url') || h.includes('gốc'));
  let statusIdx = headers.findIndex(h => 
    h.includes('thể lệ') || 
    h.includes('trạng thái') || 
    h.includes('duyệt') || 
    h.includes('tình trạng') || 
    h.includes('ghi chú') || 
    h.includes('status') || 
    h.includes('note')
  );

  // Heuristic Fallback: Quét các dòng dữ liệu mẫu để tự nhận diện cột nếu header không khớp
  const numCols = rows[0] ? rows[0].length : 5;
  for (let col = 0; col < numCols; col++) {
    for (let rIdx = 0; rIdx < Math.min(rows.length, 20); rIdx++) {
      const cell = String(rows[rIdx]?.[col] || '').trim();
      if (!cell) continue;

      // Nhận diện link video
      if (linkIdx === -1 && (cell.includes('tiktok.com') || cell.includes('facebook.com') || cell.includes('fb.watch') || cell.startsWith('http://') || cell.startsWith('https://'))) {
        linkIdx = col;
      }

      // Nhận diện số điện thoại (9-11 số)
      const cleanPhone = cell.replace(/[\s.-]/g, '');
      if (phoneIdx === -1 && /(^(0|\+?84)[3|5|7|8|9][0-9]{8}$)/.test(cleanPhone)) {
        phoneIdx = col;
      }

      // Nhận diện thời gian
      if (timestampIdx === -1 && (/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(cell) || /\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(cell))) {
        timestampIdx = col;
      }

      // Nhận diện cột trạng thái nếu có giá trị 'sai thể lệ', 'loại', 'vi phạm'
      if (statusIdx === -1 && isDisqualifiedStatus(cell)) {
        statusIdx = col;
      }
    }
  }

  // Nếu vẫn chưa xác định được statusIdx nhưng range có cột thứ 5 (ví dụ cột Q khi đọc M:Q)
  if (statusIdx === -1 && numCols >= 5) {
    const candidateIdx = 4;
    if (candidateIdx !== phoneIdx && candidateIdx !== linkIdx && candidateIdx !== canonicalLinkIdx && candidateIdx !== timestampIdx) {
      statusIdx = candidateIdx;
    }
  }

  if (phoneIdx === -1) phoneIdx = 0;
  if (linkIdx === -1) linkIdx = rows[0] && rows[0].length > 1 ? rows[0].length - 1 : 1;

  // Kiểm tra dòng đầu có phải header không
  const firstRowIsHeader = headers.some(h => h.includes('link') || h.includes('sđt') || h.includes('phone') || h.includes('stt') || h.includes('nền tảng') || h.includes('thể lệ') || h.includes('trạng thái'));
  const startRowIdx = firstRowIsHeader ? 1 : 0;

  const submissions = [];
  for (let i = startRowIdx; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;

    const rawTimestamp = timestampIdx !== -1 && r[timestampIdx] ? String(r[timestampIdx]).trim() : '';
    const rawPhone = phoneIdx !== -1 && r[phoneIdx] ? String(r[phoneIdx]).trim() : '';
    
    // Fallback: Ưu tiên lấy Link chuẩn (nếu có dữ liệu), không thì lấy Link gốc
    const valCanonical = canonicalLinkIdx !== -1 && r[canonicalLinkIdx] ? String(r[canonicalLinkIdx]).trim() : '';
    const valOriginal = linkIdx !== -1 && r[linkIdx] ? String(r[linkIdx]).trim() : '';
    const rawLink = valCanonical || valOriginal || '';

    // Lấy trạng thái duyệt (nếu có)
    const rawStatus = statusIdx !== -1 && r[statusIdx] ? String(r[statusIdx]).trim() : '';
    const isDisqualified = isDisqualifiedStatus(rawStatus);

    // Bỏ qua dòng trống hoặc dòng header lặp lại
    if (rawLink.toLowerCase().includes('link') && rawPhone.toLowerCase().includes('sđt')) continue;

    if (rawLink || rawPhone) {
      submissions.push({
        timestamp: rawTimestamp || new Date().toISOString(),
        rawName: '', // Không có trường tên, để trống
        rawPhone,
        rawLink,
        rawStatus,
        isDisqualified,
        rowIndex: i + 1
      });
    }
  }

  return submissions;
}

async function readSystemMeta(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${config.TABS.INTERNAL_SYSTEM_META}!A:B`
    });
    const rows = res.data.values || [];
    const meta = {};
    for (const r of rows) {
      if (r[0]) meta[r[0].trim()] = r[1] !== undefined ? String(r[1]).trim() : '';
    }
    return meta;
  } catch (err) {
    return {};
  }
}

async function readLkgState(sheets, spreadsheetId) {
  const map = new Map();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${config.TABS.INTERNAL_LKG}!A2:M`
    });
    const rows = res.data.values || [];
    for (const r of rows) {
      const compositeKey = r[0];
      if (compositeKey) {
        map.set(compositeKey, {
          composite_key: compositeKey,
          platform: r[1] || '',
          canonical_video_id: r[2] || '',
          phone: r[3] || '',
          user_name: r[4] || '',
          view: Number(r[5]) || 0,
          react: Number(r[6]) || 0,
          comment: Number(r[7]) || 0,
          status: r[8] || config.VIDEO_STATUS.OK,
          last_successful_at: r[9] || '',
          consecutive_errors: Number(r[10]) || 0,
          first_error_at: r[11] || '',
          updated_at: r[12] || ''
        });
      }
    }
  } catch (err) {
    console.warn('[GoogleSheet] Error reading LKG_State:', err.message);
  }
  return map;
}

async function readPreparedBxh(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${config.TABS.INTERNAL_PREPARED}!A2:H`
    });
    return res.data.values || [];
  } catch (err) {
    return [];
  }
}

/**
 * Đo số dòng có dữ liệu thực tế (dựa vào cột A).
 */
async function getLastWrittenRowCount(sheets, spreadsheetId, tabName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:A` // Chỉ đếm cột A
  });
  return (res.data.values || []).length;
}

/**
 * Xây dựng Request appendDimension và updateCells động.
 */
function buildDynamicAtomicUpdate(sheetMeta, tabName, allRows, previousRowCount) {
  const sheetProp = sheetMeta[tabName];
  if (!sheetProp) throw new Error(`Tab ${tabName} not found in metadata`);
  
  const sheetId = sheetProp.properties.sheetId;
  const currentGridRowCount = sheetProp.properties.gridProperties.rowCount;
  const colCount = allRows[0] ? allRows[0].length : 20; // default width if empty
  
  const clearUpTo = Math.max(allRows.length, previousRowCount);
  const requests = [];

  if (clearUpTo > currentGridRowCount) {
    requests.push({
      appendDimension: {
        sheetId,
        dimension: 'ROWS',
        length: clearUpTo - currentGridRowCount
      }
    });
  }

  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: clearUpTo,
        startColumnIndex: 0,
        endColumnIndex: colCount
      },
      rows: buildRowDataMatrix(allRows, clearUpTo, colCount),
      fields: 'userEnteredValue'
    }
  });

  return requests;
}

/**
 * Helper to build RowData matrix for updateCells
 */
function buildRowDataMatrix(rows, clearUpTo, numCols) {
  if (rows.length > clearUpTo) {
    throw new Error(`Data overflow: rows.length (${rows.length}) > clearUpTo (${clearUpTo})`);
  }

  const matrix = [];
  for (let i = 0; i < clearUpTo; i++) {
    const rowValues = [];
    for (let j = 0; j < numCols; j++) {
      const val = (i < rows.length && rows[i][j] !== undefined && rows[i][j] !== null) ? rows[i][j] : '';
      
      let userEnteredValue = {};
      if (val === '') {
        userEnteredValue = {};
      } else if (typeof val === 'number') {
        if (Number.isNaN(val)) throw new Error(`NaN is not allowed in Sheets: row ${i} col ${j}`);
        userEnteredValue = { numberValue: val };
      } else if (typeof val === 'boolean') {
        userEnteredValue = { boolValue: val };
      } else {
        const strVal = String(val);
        // Bảo vệ raw formula: nếu bắt đầu bằng +, =, @ thì thêm nháy đơn
        if (/^[+=@]/.test(strVal) && !strVal.startsWith("'")) {
          userEnteredValue = { stringValue: "'" + strVal };
        } else {
          userEnteredValue = { stringValue: strVal };
        }
      }
      rowValues.push({ userEnteredValue });
    }
    matrix.push({ values: rowValues });
  }
  return matrix;
}

/**
 * PHASE 1 - Internal Atomic
 */
async function writePhase1Internal({
  sheets, spreadsheetId, lkgRows, chiTietRows, canhBaoRows, preparedBxhRows, runHistoryRow, preparedMeta
}) {
  const meta = await getSheetMeta(sheets, spreadsheetId);
  
  const headers = {
    lkg: [['composite_key', 'platform', 'canonical_video_id', 'phone', 'user_name', 'view', 'react', 'comment', 'status', 'last_successful_at', 'consecutive_errors', 'first_error_at', 'updated_at']],
    chiTiet: [['composite_key', 'platform', 'user_name', 'phone_raw', 'phone_masked', 'link_raw', 'canonical_url', 'status', 'view', 'react', 'comment', 'is_lkg', 'error_details', 'updated_at']],
    canhBao: [['type', 'composite_key', 'user_name', 'phone_masked', 'link_raw', 'message', 'detected_at']],
    prepared: [['rank', 'user_display', 'phone_masked', 'total_view', 'total_comment', 'total_react', 'video_count', 'primary_timestamp']]
  };

  const allLkg = [...headers.lkg, ...lkgRows];
  const allChiTiet = [...headers.chiTiet, ...chiTietRows];
  const allCanhBao = [...headers.canhBao, ...canhBaoRows];
  const allPrepared = [...headers.prepared, ...preparedBxhRows];

  const [prevLkg, prevChiTiet, prevCanhBao, prevPrepared] = await Promise.all([
    getLastWrittenRowCount(sheets, spreadsheetId, config.TABS.INTERNAL_LKG),
    getLastWrittenRowCount(sheets, spreadsheetId, config.TABS.INTERNAL_CHI_TIET),
    getLastWrittenRowCount(sheets, spreadsheetId, config.TABS.INTERNAL_CANH_BAO),
    getLastWrittenRowCount(sheets, spreadsheetId, config.TABS.INTERNAL_PREPARED)
  ]);

  const requests = [
    ...buildDynamicAtomicUpdate(meta, config.TABS.INTERNAL_LKG, allLkg, prevLkg),
    ...buildDynamicAtomicUpdate(meta, config.TABS.INTERNAL_CHI_TIET, allChiTiet, prevChiTiet),
    ...buildDynamicAtomicUpdate(meta, config.TABS.INTERNAL_CANH_BAO, allCanhBao, prevCanhBao),
    ...buildDynamicAtomicUpdate(meta, config.TABS.INTERNAL_PREPARED, allPrepared, prevPrepared)
  ];

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });
  }

  // System Meta
  const sysMeta = await readSystemMeta(sheets, spreadsheetId);
  const mergedMeta = { ...sysMeta, ...preparedMeta, RUN_STATUS: config.RUN_STATUS.PREPARED };
  const metaArr = [['Key', 'Value']];
  for (const [k, v] of Object.entries(mergedMeta)) {
    metaArr.push([k, v !== undefined && v !== null ? String(v) : '']);
  }
  
  const metaPrev = await getLastWrittenRowCount(sheets, spreadsheetId, config.TABS.INTERNAL_SYSTEM_META);
  const metaReqs = buildDynamicAtomicUpdate(meta, config.TABS.INTERNAL_SYSTEM_META, metaArr, metaPrev);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: metaReqs }
  });

  // Run History Append (Not overwrite)
  if (runHistoryRow && runHistoryRow.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${config.TABS.INTERNAL_RUN_HISTORY}!A2`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [runHistoryRow] }
    });
  }
}

/**
 * PHASE 2 - Public Atomic
 */
async function writePhase2Public(sheets, spreadsheetId, publicBxhRows) {
  const meta = await getSheetMeta(sheets, spreadsheetId);
  const targetTab = Object.keys(meta)[0] || config.TABS.PUBLIC_BXH;

  const header = ['Hạng', 'User thí sinh', 'View', 'Comment', 'React'];
  const allRows = [header, ...publicBxhRows];

  const prevCount = await getLastWrittenRowCount(sheets, spreadsheetId, targetTab);
  const requests = buildDynamicAtomicUpdate(meta, targetTab, allRows, prevCount);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests }
  });
}

/**
 * PHASE 3 - Confirm Publish
 */
async function confirmPhase3Published(sheets, spreadsheetId, runId) {
  const sysMeta = await readSystemMeta(sheets, spreadsheetId);
  const mergedMeta = { ...sysMeta, RUN_STATUS: config.RUN_STATUS.PUBLISHED, PUBLISHED_RUN_ID: runId };
  const metaArr = [['Key', 'Value']];
  for (const [k, v] of Object.entries(mergedMeta)) {
    metaArr.push([k, v !== undefined && v !== null ? String(v) : '']);
  }
  
  const meta = await getSheetMeta(sheets, spreadsheetId);
  const metaPrev = await getLastWrittenRowCount(sheets, spreadsheetId, config.TABS.INTERNAL_SYSTEM_META);
  const metaReqs = buildDynamicAtomicUpdate(meta, config.TABS.INTERNAL_SYSTEM_META, metaArr, metaPrev);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: metaReqs }
  });
}

/**
 * Append Audit Log for Manual Actions
 */
async function appendApprovalAudit(sheets, spreadsheetId, auditRow) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${config.TABS.INTERNAL_APPROVAL_AUDIT}!A2`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [auditRow] }
  });
}

module.exports = {
  getSheetsClient,
  getSheetMeta,
  ensureInternalTabsExist,
  readSourceFormSubmissions,
  readSystemMeta,
  readLkgState,
  readPreparedBxh,
  writePhase1Internal,
  writePhase2Public,
  confirmPhase3Published,
  appendApprovalAudit
};
