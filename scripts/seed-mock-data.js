const { getSheetsClient } = require('../src/services/google-sheet');
const config = require('../src/config');

async function seed() {
  const sheets = getSheetsClient();
  const spreadsheetId = config.GOOGLE_SOURCE_SHEET_ID;
  
  const resMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetName = resMeta.data.sheets[0].properties.title;

  const values = [
    ['Timestamp', 'Họ và tên', 'Số điện thoại', 'Link Video UGC'],
    ['05/08/2026 14:20:00', 'Nguyễn Văn Test', '0912345678', 'https://www.tiktok.com/@user/video/7333575971449326850'],
    ['10/08/2026 09:15:30', 'Trần Thị Giả', '0987654321', 'https://www.facebook.com/watch/?v=123456789012345']
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:D3`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });

  console.log(`✅ Seeded 2 mock records into ${sheetName}`);
}

seed().catch(console.error);
