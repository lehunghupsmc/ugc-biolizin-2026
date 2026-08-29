const test = require('node:test');
const assert = require('node:assert');
const { mapTikTokMetrics, mapFacebookMetrics } = require('../../src/services/metric-mapper');

test('scraper-contract: TikTok Apify Schema', async (t) => {
  await t.test('khớp với response thực tế của actor clockworks/free-tiktok-scraper', () => {
    const fixture = {
      id: '7525806036511444232',
      text: 'Bài dự thi Biolizin',
      playCount: 125000,
      diggCount: 3400,
      commentCount: 180,
      shareCount: 45,
      webVideoUrl: 'https://www.tiktok.com/@biolizin/video/7525806036511444232'
    };

    const result = mapTikTokMetrics(fixture);
    assert.strictEqual(result.view, 125000);
    assert.strictEqual(result.react, 3400);
    assert.strictEqual(result.comment, 180);
    assert.strictEqual(result.share, 45);
  });
});

test('scraper-contract: Facebook Bright Data Schema', async (t) => {
  await t.test('khớp với response thực tế của dataset gd_lyclm1571iy3mv57zw', () => {
    const fixture = {
      url: 'https://www.facebook.com/reel/1234567890/',
      video_view_count: 85000,
      likes: 2900,
      num_comments: 110,
      num_shares: 15
    };

    const result = mapFacebookMetrics(fixture);
    assert.strictEqual(result.view, 85000);
    assert.strictEqual(result.react, 2900);
    assert.strictEqual(result.comment, 110);
    assert.strictEqual(result.share, 15);
  });
});
