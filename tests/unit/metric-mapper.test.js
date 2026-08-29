const test = require('node:test');
const assert = require('node:assert');
const {
  validateStrictInteger,
  mapTikTokMetrics,
  mapFacebookMetrics
} = require('../../src/services/metric-mapper');

test('metric-mapper: validateStrictInteger', async (t) => {
  await t.test('chấp nhận số nguyên không âm an toàn', () => {
    assert.strictEqual(validateStrictInteger(0), 0);
    assert.strictEqual(validateStrictInteger(12345), 12345);
    assert.strictEqual(validateStrictInteger('12345'), 12345);
    assert.strictEqual(validateStrictInteger('0'), 0);
  });

  await t.test('từ chối chuỗi rút gọn, có ký tự lạ hoặc định dạng sai', () => {
    assert.strictEqual(validateStrictInteger('1.2K'), null);
    assert.strictEqual(validateStrictInteger('12,345'), null);
    assert.strictEqual(validateStrictInteger('100M'), null);
    assert.strictEqual(validateStrictInteger('abc'), null);
    assert.strictEqual(validateStrictInteger('-50'), null);
    assert.strictEqual(validateStrictInteger(-10), null);
    assert.strictEqual(validateStrictInteger(12.34), null);
    assert.strictEqual(validateStrictInteger(null), null);
    assert.strictEqual(validateStrictInteger(undefined), null);
    assert.strictEqual(validateStrictInteger(NaN), null);
    assert.strictEqual(validateStrictInteger(Infinity), null);
  });
});

test('metric-mapper: mapTikTokMetrics', async (t) => {
  await t.test('trích xuất đúng dữ liệu từ Apify response', () => {
    const item = {
      playCount: 150000,
      diggCount: 4500,
      commentCount: 230,
      shareCount: 50
    };

    const mapped = mapTikTokMetrics(item);
    assert.strictEqual(mapped.view, 150000);
    assert.strictEqual(mapped.react, 4500);
    assert.strictEqual(mapped.comment, 230);
    assert.strictEqual(mapped.share, 50);
  });

  await t.test('hỗ trợ cấu trúc lồng stats / statsV2', () => {
    const item = {
      stats: {
        playCount: 80000,
        diggCount: 1200,
        commentCount: 95
      }
    };

    const mapped = mapTikTokMetrics(item);
    assert.strictEqual(mapped.view, 80000);
    assert.strictEqual(mapped.react, 1200);
    assert.strictEqual(mapped.comment, 95);
  });
});

test('metric-mapper: mapFacebookMetrics', async (t) => {
  await t.test('trích xuất đúng dữ liệu từ Bright Data response', () => {
    const item = {
      video_view_count: 95000,
      likes: 3100,
      num_comments: 140,
      num_shares: 20
    };

    const mapped = mapFacebookMetrics(item);
    assert.strictEqual(mapped.view, 95000);
    assert.strictEqual(mapped.react, 3100);
    assert.strictEqual(mapped.comment, 140);
    assert.strictEqual(mapped.share, 20);
  });

  await t.test('tính tổng reactions từ mảng num_likes_type', () => {
    const item = {
      video_view_count: 50000,
      num_likes_type: [
        { type: 'like', num: 100 },
        { type: 'love', num: 50 },
        { type: 'haha', num: 10 }
      ],
      num_comments: 40
    };

    const mapped = mapFacebookMetrics(item);
    assert.strictEqual(mapped.view, 50000);
    assert.strictEqual(mapped.react, 160);
    assert.strictEqual(mapped.comment, 40);
  });
});
