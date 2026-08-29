const { getSheetsClient } = require('../src/services/google-sheet');
const config = require('../src/config');
async function unfreeze() {
  const sheets = getSheetsClient();
  const spreadsheetId = config.GOOGLE_INTERNAL_SHEET_ID;
  
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `System_Meta!A1:B5`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [
        ['Key', 'Value'],
        ['RUN_STATUS', 'IDLE'],
        ['CONTEST_STATUS', 'ACTIVE'],
        ['CONTEST_END_AT', config.CONTEST_END_AT],
        ['FROZEN_AT', '']
    ]}
  });
  console.log(`✅ System Unfrozen`);
}
unfreeze().catch(console.error);
