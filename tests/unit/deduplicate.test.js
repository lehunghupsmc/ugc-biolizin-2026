const test = require('node:test');
const assert = require('node:assert');
const { processSubmissionsAndDeduplicate } = require('../../src/ranking');
const config = require('../../src/config');

test('deduplicate: processSubmissionsAndDeduplicate', async (t) => {
  // Override config for testing timestamp filters
  const origStart = config.SUBMISSION_START_AT;
  const origEnd = config.SUBMISSION_END_AT;
  config.SUBMISSION_START_AT = '2026-08-01T00:00:00Z';
  config.SUBMISSION_END_AT = '2026-08-30T23:59:59Z';

  await t.test('2 SĐT nộp cùng 1 Video ID -> First-Come First-Served', async () => {
    const mockSubmissions = [
      {
        timestamp: '20/08/2026 10:00:00',
        rawName: 'Nguyen Van A',
        rawPhone: '0912345678',
        rawLink: 'https://www.tiktok.com/@user/video/7525806036511444232',
        rowIndex: 2
      },
      {
        timestamp: '20/08/2026 11:00:00',
        rawName: 'Tran Thi B',
        rawPhone: '0987654321',
        rawLink: 'https://www.tiktok.com/@user/video/7525806036511444232',
        rowIndex: 3
      }
    ];

    const { validVideos, warnings } = await processSubmissionsAndDeduplicate(mockSubmissions);

    assert.strictEqual(validVideos.length, 1);
    assert.strictEqual(validVideos[0].phone, '0912345678');
    assert.strictEqual(validVideos[0].name, 'Nguyen Van A');

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].type, 'DISPUTE_FIRST_COME');
  });

  await t.test('Cùng 1 SĐT nộp trùng link video nhiều lần -> Chỉ nhận 1 lần', async () => {
    const mockSubmissions = [
      {
        timestamp: '20/08/2026 10:00:00',
        rawName: 'Nguyen Van A',
        rawPhone: '0912345678',
        rawLink: 'https://www.tiktok.com/@user/video/7525806036511444232',
        rowIndex: 2
      },
      {
        timestamp: '20/08/2026 11:00:00',
        rawName: 'Nguyen Van A',
        rawPhone: '0912345678',
        rawLink: 'https://www.tiktok.com/@user/video/7525806036511444232',
        rowIndex: 3
      }
    ];

    const { validVideos, warnings } = await processSubmissionsAndDeduplicate(mockSubmissions);

    assert.strictEqual(validVideos.length, 1);
    assert.strictEqual(validVideos[0].phone, '0912345678');
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].type, 'DUPLICATE_SUBMISSION');
  });

  await t.test('1 SĐT nộp 2 link video khác nhau -> Nhận cả 2', async () => {
    const mockSubmissions = [
      {
        timestamp: '20/08/2026 10:00:00',
        rawName: 'Nguyen Van A',
        rawPhone: '0912345678',
        rawLink: 'https://www.tiktok.com/@user/video/1111111111111111111',
        rowIndex: 2
      },
      {
        timestamp: '20/08/2026 11:00:00',
        rawName: 'Nguyen Van A',
        rawPhone: '0912345678',
        rawLink: 'https://www.tiktok.com/@user/video/2222222222222222222',
        rowIndex: 3
      }
    ];

    const { validVideos, warnings } = await processSubmissionsAndDeduplicate(mockSubmissions);

    assert.strictEqual(validVideos.length, 2);
    assert.strictEqual(validVideos[0].videoId, '1111111111111111111');
    assert.strictEqual(validVideos[1].videoId, '2222222222222222222');
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('Bài thi bị đánh dấu Sai thể lệ / isDisqualified -> Bị loại và thêm vào warnings', async () => {
    const mockSubmissions = [
      {
        timestamp: '20/08/2026 10:00:00',
        rawName: 'Nguyen Van A',
        rawPhone: '0912345678',
        rawLink: 'https://www.tiktok.com/@user/video/1111111111111111111',
        rawStatus: 'Sai thể lệ',
        isDisqualified: true,
        rowIndex: 2
      },
      {
        timestamp: '20/08/2026 11:00:00',
        rawName: 'Tran Thi B',
        rawPhone: '0987654321',
        rawLink: 'https://www.tiktok.com/@user/video/2222222222222222222',
        rawStatus: '',
        isDisqualified: false,
        rowIndex: 3
      }
    ];

    const { validVideos, warnings } = await processSubmissionsAndDeduplicate(mockSubmissions);

    assert.strictEqual(validVideos.length, 1);
    assert.strictEqual(validVideos[0].phone, '0987654321');
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].type, 'DISQUALIFIED_BY_ADMIN');
    assert.ok(warnings[0].message.includes('Sai thể lệ'));
  });

  // Restore config
  config.SUBMISSION_START_AT = origStart;
  config.SUBMISSION_END_AT = origEnd;
});
