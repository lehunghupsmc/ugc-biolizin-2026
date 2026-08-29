const test = require('node:test');
const assert = require('node:assert');
const { main } = require('../../src/index');
const googleSheet = require('../../src/services/google-sheet');
const config = require('../../src/config');
const reporter = require('../../src/services/reporter');

test('Recovery Flow - should trigger recovery if RUN_STATUS is PREPARED', async (t) => {
  // Mock everything
  t.mock.method(process, 'exit', () => {});
  t.mock.method(googleSheet, 'getSheetsClient', () => ({}));
  t.mock.method(googleSheet, 'ensureInternalTabsExist', async () => {});
  t.mock.method(googleSheet, 'readSourceFormSubmissions', async () => []);
  t.mock.method(googleSheet, 'readLkgState', async () => new Map());
  t.mock.method(reporter, 'alertOnFailure', async () => {});

  t.mock.method(googleSheet, 'readSystemMeta', async () => ({
    RUN_STATUS: config.RUN_STATUS.PREPARED
  }));

  const preparedRows = [[1, 'User1 (09***)', '09***', 100, 50, 20, 1, '2026-08-01']];
  const readPreparedBxhMock = t.mock.method(googleSheet, 'readPreparedBxh', async () => preparedRows);
  const writePhase2PublicMock = t.mock.method(googleSheet, 'writePhase2Public', async () => {});
  const confirmPhase3PublishedMock = t.mock.method(googleSheet, 'confirmPhase3Published', async () => {});

  await main();

  assert.strictEqual(readPreparedBxhMock.mock.callCount(), 1);
  assert.strictEqual(writePhase2PublicMock.mock.callCount(), 1);
  
  const publicCallArgs = writePhase2PublicMock.mock.calls[0].arguments;
  const publicRows = publicCallArgs[2];
  assert.strictEqual(publicRows[0][0], '🥇 1'); // rankBadge
  assert.strictEqual(publicRows[0][1], 'User1 (09***)');

  assert.strictEqual(confirmPhase3PublishedMock.mock.callCount(), 1);
});
