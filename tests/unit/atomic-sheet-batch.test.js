const test = require('node:test');
const assert = require('node:assert');
const { writePhase1Internal } = require('../../src/services/google-sheet');
const config = require('../../src/config');

test('Google Sheets Atomic Batch - should generate appendDimension and updateCells if rows exceed current rowCount', async () => {
  let batchUpdateArgs = null;
  const sheets = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [
            { properties: { title: config.TABS.INTERNAL_LKG, sheetId: 101, gridProperties: { rowCount: 5 } } },
            { properties: { title: config.TABS.INTERNAL_CHI_TIET, sheetId: 102, gridProperties: { rowCount: 10 } } },
            { properties: { title: config.TABS.INTERNAL_CANH_BAO, sheetId: 103, gridProperties: { rowCount: 10 } } },
            { properties: { title: config.TABS.INTERNAL_PREPARED, sheetId: 104, gridProperties: { rowCount: 10 } } },
            { properties: { title: config.TABS.INTERNAL_SYSTEM_META, sheetId: 105, gridProperties: { rowCount: 10 } } }
          ]
        }
      }),
      values: {
        get: async () => ({ data: { values: [] } }),
        append: async () => ({})
      },
      batchUpdate: async (args) => {
        batchUpdateArgs = args;
        return {};
      }
    }
  };

  const lkgRows = [
    ['k1', 'tiktok', 'v1', '09', 'User1', 10, 5, 2, 'OK', '2026-08-01', 0, '', '2026-08-01'],
    ['k2', 'tiktok', 'v2', '09', 'User2', 20, 5, 2, 'OK', '2026-08-01', 0, '', '2026-08-01'],
    ['k3', 'tiktok', 'v3', '09', 'User3', 30, 5, 2, 'OK', '2026-08-01', 0, '', '2026-08-01'],
    ['k4', 'tiktok', 'v4', '09', 'User4', 40, 5, 2, 'OK', '2026-08-01', 0, '', '2026-08-01'],
    ['k5', 'tiktok', 'v5', '09', 'User5', 50, 5, 2, 'OK', '2026-08-01', 0, '', '2026-08-01']
  ];

  await writePhase1Internal({
    sheets,
    spreadsheetId: 'dummy',
    lkgRows,
    chiTietRows: [],
    canhBaoRows: [],
    preparedBxhRows: [],
    runHistoryRow: [],
    preparedMeta: {}
  });

  assert.ok(batchUpdateArgs, 'batchUpdate should be called');
  const requests = batchUpdateArgs.requestBody.requests;
  
  const appendReq = requests.find(r => r.appendDimension && r.appendDimension.sheetId === 101);
  assert.ok(appendReq, 'appendDimension request should exist for LKG');
  assert.strictEqual(appendReq.appendDimension.length, 1, 'Should append 1 row');

  const updateReq = requests.find(r => r.updateCells && r.updateCells.range.sheetId === 101);
  assert.ok(updateReq, 'updateCells request should exist for LKG');
  assert.strictEqual(updateReq.updateCells.range.endRowIndex, 6, 'Should update 6 rows');
});
