const config = require('../src/config');
const googleSheet = require('../src/services/google-sheet');

async function checkSourceSheet() {
  console.log('====================================================');
  console.log('🔍 KIỂM TRA DỮ LIỆU CỘT Q SHEET \'gop_du_lieu\' (READ-ONLY)');
  console.log('⚠️ CHÚ Ý: CHẾ ĐỘ CHỈ ĐỌC - TUYỆT ĐỐI KHÔNG CÀO VIDEO / KHÔNG GHI ĐÈ');
  console.log('====================================================\n');

  let sheets;
  try {
    sheets = googleSheet.getSheetsClient();
    console.log('✅ Google Sheets Client: Khởi tạo xác thực thành công.');
  } catch (err) {
    console.error('❌ Lỗi xác thực Google Sheets:', err.message);
    process.exit(1);
  }

  const sourceSheetId = config.GOOGLE_SOURCE_SHEET_ID;
  const tabName = config.SOURCE_TAB_NAME || 'gop_du_lieu';
  const rangeQuery = `${tabName}!M:Q`;

  console.log(`[CheckSheet] Đang đọc dữ liệu từ: ${rangeQuery} ...`);

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sourceSheetId,
      range: rangeQuery
    });

    const rows = res.data.values || [];
    console.log(`[CheckSheet] Tổng số dòng đọc được từ range M:Q: ${rows.length} dòng.\n`);

    if (rows.length === 0) {
      console.warn('⚠️ Không tìm thấy dòng dữ liệu nào trong range M:Q.');
      return;
    }

    const headerRow = rows[0] || [];
    console.log('📌 Header các cột trong range M:Q:');
    const colNames = ['Cột M', 'Cột N', 'Cột O', 'Cột P', 'Cột Q'];
    for (let c = 0; c < 5; c++) {
      console.log(`   - ${colNames[c]}: "${headerRow[c] || '(trống)'}"`);
    }
    console.log('');

    // Quét toàn bộ các dòng để tìm cột Q có dữ liệu
    const disqualifiedRows = [];
    const allColQValues = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;

      const colQVal = r[4] !== undefined ? String(r[4]).trim() : '';
      if (colQVal) {
        const rowInfo = {
          sheetRowIndex: i + 1, // Dòng 1-indexed trong Google Sheet
          colM: r[0] || '',
          colN: r[1] || '',
          colO: r[2] || '',
          colP: r[3] || '',
          colQ: colQVal
        };

        allColQValues.push(rowInfo);

        if (colQVal.toLowerCase().includes('sai thể lệ') || colQVal.toLowerCase().includes('loại')) {
          disqualifiedRows.push(rowInfo);
        }
      }
    }

    console.log(`📊 KẾT QUẢ QUÉT CỘT Q:`);
    console.log(`- Tổng số dòng có dữ liệu ở cột Q: ${allColQValues.length}`);
    console.log(`- Số dòng có giá trị "Sai thể lệ": ${disqualifiedRows.length}\n`);

    if (disqualifiedRows.length > 0) {
      console.log('🎯 DANH SÁCH CÁC DÒNG CÓ GIÁ TRỊ "Sai thể lệ":');
      disqualifiedRows.forEach((item, idx) => {
        console.log(`   ${idx + 1}. Dòng Sheet: #${item.sheetRowIndex}`);
        console.log(`      - Giá trị Cột Q: "${item.colQ}"`);
        console.log(`      - Cột M: ${item.colM}`);
        console.log(`      - Cột N: ${item.colN}`);
        console.log(`      - Cột O: ${item.colO}`);
        console.log(`      - Cột P: ${item.colP}`);
      });
    } else {
      console.log('⚠️ Chưa tìm thấy dòng nào có chữ "Sai thể lệ" ở cột Q.');
      if (allColQValues.length > 0) {
        console.log('Các giá trị cột Q đang có:', allColQValues);
      }
    }

    console.log('\n====================================================');
    console.log('✅ HOÀN TẤT KIỂM TRA. KHÔNG CÓ VIDEO NÀO BỊ CÀO. AN TOÀN 100%!');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ Lỗi khi đọc dữ liệu từ Google Sheets:', err.message);
    process.exit(1);
  }
}

checkSourceSheet();
