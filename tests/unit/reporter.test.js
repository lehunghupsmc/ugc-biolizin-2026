const test = require('node:test');
const assert = require('node:assert');
const { buildSummaryMarkdown } = require('../../src/services/reporter');

test('reporter: buildSummaryMarkdown', async (t) => {
  await t.test('tạo Markdown summary đầy đủ bảng biểu và số liệu', () => {
    const stats = {
      runId: 'run-2026-08-28T08-15',
      action: 'daily',
      startedAt: '2026-08-28T08:15:00Z',
      completedAt: '2026-08-28T08:17:30Z',
      totalSubmissions: 50,
      uniqueVideos: 45,
      okCount: 40,
      lkgFallbackCount: 4,
      errorCount: 1,
      pendingCount: 0,
      top5: [
        ['🥇 1', 'Nguyễn Văn A (091***678)', 520000, 450, 3750],
        ['🥈 2', 'Trần Thị B (098***234)', 256700, 258, 1538]
      ],
      warnings: [
        {
          type: 'DISPUTE_FIRST_COME',
          composite_key: 'tiktok:123456',
          message: 'Tranh chấp link'
        }
      ],
      contestStatus: 'ACTIVE',
      runStatus: 'PUBLISHED'
    };

    const md = buildSummaryMarkdown(stats);

    assert.match(md, /UGC Biolizin Contest Tracker - Run Summary/);
    assert.match(md, /run-2026-08-28T08-15/);
    assert.match(md, /Nguyễn Văn A/);
    assert.match(md, /DISPUTE_FIRST_COME/);
    assert.match(md, /520,000/);
  });
});
