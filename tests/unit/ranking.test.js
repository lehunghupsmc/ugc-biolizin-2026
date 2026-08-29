const test = require('node:test');
const assert = require('node:assert');
const { calculateRanking } = require('../../src/ranking');

test('ranking: calculateRanking', async (t) => {
  await t.test('Sắp xếp theo thứ tự: View giảm dần -> React+Comment -> Timestamp sớm hơn', () => {
    const videoData = [
      // Thí sinh A: 100k view
      {
        phone: '0911111111',
        name: 'Nguyễn Văn A',
        timestamp: '2026-08-20T10:00:00Z', parsedTime: new Date('').getTime(),
        view: 100000,
        react: 1000,
        comment: 100
      },
      // Thí sinh B: 500k view (Top 1)
      {
        phone: '0922222222',
        name: 'Trần Thị B',
        timestamp: '2026-08-20T12:00:00Z', parsedTime: new Date('').getTime(),
        view: 500000,
        react: 5000,
        comment: 500
      },
      // Thí sinh C: 100k view, nhưng react+comment cao hơn A
      {
        phone: '0933333333',
        name: 'Lê Văn C',
        timestamp: '2026-08-20T15:00:00Z', parsedTime: new Date('').getTime(),
        view: 100000,
        react: 2000,
        comment: 200
      },
      // Thí sinh D: 100k view, cùng react+comment với A nhưng nộp sớm hơn A
      {
        phone: '0944444444',
        name: 'Phạm Văn D',
        timestamp: '2026-08-19T08:00:00Z', parsedTime: new Date('').getTime(), // Nộp trước A 1 ngày
        view: 100000,
        react: 1000,
        comment: 100
      }
    ];

    const { publicBxhRows, rankedContestants } = calculateRanking(videoData);

    // Thứ tự mong đợi:
    // Hạng 1: B (500k view)
    // Hạng 2: C (100k view, engagement 2200)
    // Hạng 3: D (100k view, engagement 1100, timestamp sớm hơn A)
    // Hạng 4: A (100k view, engagement 1100, timestamp sau D)

    assert.strictEqual(rankedContestants[0].phone, '0922222222');
    assert.strictEqual(rankedContestants[1].phone, '0933333333');
    assert.strictEqual(rankedContestants[2].phone, '0944444444');
    assert.strictEqual(rankedContestants[3].phone, '0911111111');

    // Kiểm tra huy chương
    assert.strictEqual(publicBxhRows[0][0], '🥇 1');
    assert.strictEqual(publicBxhRows[1][0], '🥈 2');
    assert.strictEqual(publicBxhRows[2][0], '🥉 3');
    assert.strictEqual(publicBxhRows[3][0], '4');

    // Kiểm tra định dạng mask
    assert.match(publicBxhRows[0][1], /Trần Thị B \(092\*\*\*222\)/);
  });

  await t.test('1 thí sinh có nhiều video -> Cộng dồn điểm số', () => {
    const videoData = [
      {
        phone: '0911111111',
        name: 'Nguyễn Văn A',
        timestamp: '2026-08-20T10:00:00Z', parsedTime: new Date('').getTime(),
        view: 30000,
        react: 300,
        comment: 30
      },
      {
        phone: '0911111111',
        name: 'Nguyễn Văn A',
        timestamp: '2026-08-21T10:00:00Z', parsedTime: new Date('').getTime(),
        view: 70000,
        react: 700,
        comment: 70
      }
    ];

    const { rankedContestants } = calculateRanking(videoData);

    assert.strictEqual(rankedContestants.length, 1);
    assert.strictEqual(rankedContestants[0].totalView, 100000);
    assert.strictEqual(rankedContestants[0].totalReact, 1000);
    assert.strictEqual(rankedContestants[0].totalComment, 100);
    assert.strictEqual(rankedContestants[0].videoCount, 2);
  });
});
