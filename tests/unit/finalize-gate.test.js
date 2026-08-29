const test = require('node:test');
const assert = require('node:assert');
const { main } = require('../../src/index');
const googleSheet = require('../../src/services/google-sheet');
const config = require('../../src/config');
const reporter = require('../../src/services/reporter');
const tiktokScraper = require('../../src/scrapers/tiktok');

test('Finalize Gate - should block finalize if there is a CONFIRMED_UNAVAILABLE video', async (t) => {
  t.mock.method(process, 'exit', () => {});
  t.mock.method(googleSheet, 'getSheetsClient', () => ({}));
  t.mock.method(googleSheet, 'ensureInternalTabsExist', async () => {});
  t.mock.method(googleSheet, 'readSystemMeta', async () => ({ RUN_STATUS: config.RUN_STATUS.IDLE }));
  t.mock.method(googleSheet, 'readPreparedBxh', async () => []);
  const alertMock = t.mock.method(reporter, 'alertOnFailure', async () => {});

  // Override argv
  process.argv = ['node', 'index.js', '--action=finalize'];

  t.mock.method(googleSheet, 'readSourceFormSubmissions', async () => [
    { rawName: 'User1', rawPhone: '0912345678', rawLink: 'https://www.tiktok.com/@user/video/123', timestamp: '2026-08-01T00:00:00Z', rowIndex: 2 }
  ]);
  
  t.mock.method(tiktokScraper, 'scrapeTikTokBatch', async () => new Map([
    ['https://www.tiktok.com/@user/video/123', { ok: false, errorType: config.VIDEO_STATUS.CONFIRMED_UNAVAILABLE }]
  ]));

  t.mock.method(googleSheet, 'readLkgState', async () => new Map([
    ['tiktok:123', { view: 100, react: 50, comment: 20 }] // Có LKG -> status = CONFIRMED_UNAVAILABLE
  ]));

  await main();

  assert.strictEqual(alertMock.mock.callCount(), 1);
  const errorMsg = alertMock.mock.calls[0].arguments[0].errorMessage;
  assert.match(errorMsg, /Finalize Gate blocked/);
});

test('Finalize Gate - should pass finalize if all videos are OK or RESET_APPROVED', async (t) => {
  t.mock.method(process, 'exit', () => {});
  t.mock.method(googleSheet, 'getSheetsClient', () => ({}));
  t.mock.method(googleSheet, 'ensureInternalTabsExist', async () => {});
  t.mock.method(googleSheet, 'readSystemMeta', async () => ({ RUN_STATUS: config.RUN_STATUS.IDLE }));
  t.mock.method(googleSheet, 'readPreparedBxh', async () => []);
  const alertMock = t.mock.method(reporter, 'alertOnFailure', async () => {});
  const writePhase1InternalMock = t.mock.method(googleSheet, 'writePhase1Internal', async () => {});
  t.mock.method(googleSheet, 'writePhase2Public', async () => {});
  t.mock.method(googleSheet, 'confirmPhase3Published', async () => {});

  process.argv = ['node', 'index.js', '--action=finalize'];

  t.mock.method(googleSheet, 'readSourceFormSubmissions', async () => [
    { rawName: 'User1', rawPhone: '0912345678', rawLink: 'https://www.tiktok.com/@user/video/123', timestamp: '2026-08-01T00:00:00Z', rowIndex: 2 }
  ]);
  
  t.mock.method(tiktokScraper, 'scrapeTikTokBatch', async () => new Map([
    ['https://www.tiktok.com/@user/video/123', { ok: true, data: { playCount: 100, diggCount: 50, commentCount: 20 } }]
  ]));

  t.mock.method(googleSheet, 'readLkgState', async () => new Map());

  await main();

  assert.strictEqual(alertMock.mock.callCount(), 0);
  assert.strictEqual(writePhase1InternalMock.mock.callCount(), 1);
});
