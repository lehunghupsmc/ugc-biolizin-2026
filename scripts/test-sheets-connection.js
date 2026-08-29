const { getSheetsClient, getSheetMeta, ensureInternalTabsExist, readSourceFormSubmissions } = require('../src/services/google-sheet');
const { maskPhoneNumber } = require('../src/services/normalizer');
const config = require('../src/config');

async function testConnection() {
  console.log('Testing Google Sheets connectivity with Service Account...');
  console.log('Key Client Email:', config.getServiceAccountCredentials()?.client_email);

  try {
    const sheets = getSheetsClient();

    // 1. Kiểm tra Sheet 1 (Source)
    console.log(`\n1. Checking Sheet 1 (Source): ${config.GOOGLE_SOURCE_SHEET_ID}`);
    const sheet1Meta = await getSheetMeta(sheets, config.GOOGLE_SOURCE_SHEET_ID);
    console.log('   Tabs found:', Object.keys(sheet1Meta));
    const submissions = await readSourceFormSubmissions(sheets, config.GOOGLE_SOURCE_SHEET_ID);
    console.log(`   Found ${submissions.length} submission rows.`);
    if (submissions.length > 0) {
      const sample = submissions[0];
      const redactedSample = {
        ...sample,
        rawPhone: maskPhoneNumber(sample.rawPhone),
        rawName: sample.rawName ? `${sample.rawName.slice(0, 2)}***` : ''
      };
      console.log('   Sample row 1 (Redacted PII):', redactedSample);
    }

    // 2. Kiểm tra Sheet 2 (Internal)
    console.log(`\n2. Checking Sheet 2 (Internal): ${config.GOOGLE_INTERNAL_SHEET_ID}`);
    const sheet2MetaBefore = await getSheetMeta(sheets, config.GOOGLE_INTERNAL_SHEET_ID);
    console.log('   Tabs before:', Object.keys(sheet2MetaBefore));
    console.log('   Ensuring 7 internal tabs exist...');
    await ensureInternalTabsExist(sheets, config.GOOGLE_INTERNAL_SHEET_ID);
    const sheet2MetaAfter = await getSheetMeta(sheets, config.GOOGLE_INTERNAL_SHEET_ID);
    console.log('   Tabs after:', Object.keys(sheet2MetaAfter));

    // 3. Kiểm tra Sheet 3 (Public)
    console.log(`\n3. Checking Sheet 3 (Public): ${config.GOOGLE_PUBLIC_SHEET_ID}`);
    const sheet3Meta = await getSheetMeta(sheets, config.GOOGLE_PUBLIC_SHEET_ID);
    console.log('   Tabs found:', Object.keys(sheet3Meta));

    console.log('\n✅ ALL GOOGLE SHEETS ARE ACCESSIBLE AND CONFIGURED CORRECTLY!');
  } catch (err) {
    console.error('\n❌ Google Sheets Connection Error:', err.message);
    if (err.message.includes('permission') || err.message.includes('403') || err.message.includes('404')) {
      console.error('👉 Tip: Please share the spreadsheet with Viewer/Editor permissions to the service account email.');
    }
  }
}

testConnection();
