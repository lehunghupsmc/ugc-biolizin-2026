const test = require('node:test');
const assert = require('node:assert');
const config = require('../../src/config');

test('google-sheet: configuration and tab names', async (t) => {
  await t.test('định nghĩa đủ 6 tab bắt buộc trên Sheet Internal', () => {
    assert.strictEqual(config.TABS.INTERNAL_LKG, 'LKG_State');
    assert.strictEqual(config.TABS.INTERNAL_CHI_TIET, 'Chi_Tiet');
    assert.strictEqual(config.TABS.INTERNAL_CANH_BAO, 'Canh_Bao');
    assert.strictEqual(config.TABS.INTERNAL_PREPARED, 'Prepared_BXH');
    assert.strictEqual(config.TABS.INTERNAL_RUN_HISTORY, 'Run_History');
    assert.strictEqual(config.TABS.INTERNAL_SYSTEM_META, 'System_Meta');
  });

  await t.test('định nghĩa tab Public', () => {
    assert.strictEqual(config.TABS.PUBLIC_BXH, 'BXH');
  });

  await t.test('Service Account key nạp thành công', () => {
    const creds = config.getServiceAccountCredentials();
    assert.ok(creds !== null, 'Service account credentials should be loaded');
    assert.strictEqual(creds.client_email, 'ugc-biolizin-2026@ugc-biolizin.iam.gserviceaccount.com');
  });
});
