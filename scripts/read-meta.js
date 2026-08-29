const { getSheetsClient } = require('../src/services/google-sheet');
const config = require('../src/config');
async function run() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.GOOGLE_INTERNAL_SHEET_ID, range: 'System_Meta!A1:D5' });
  console.log(res.data.values);
}
run();
