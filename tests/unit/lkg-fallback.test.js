const test = require('node:test');
const assert = require('node:assert');
const { applyAtomicSnapshot } = require('../../src/services/metric-mapper');
const { updateLkgRecord } = require('../../src/services/lkg-store');
const { VIDEO_STATUS } = require('../../src/config');

test('lkg-fallback: applyAtomicSnapshot & Atomic Rule', async (t) => {
  await t.test('Cào đủ 3 field hợp lệ -> Trả về OK và số liệu mới', () => {
    const scrapedItem = {
      playCount: 5000,
      diggCount: 300,
      commentCount: 25
    };
    const lkg = { view: 4000, react: 200, comment: 20 };

    const res = applyAtomicSnapshot('tiktok', scrapedItem, lkg);
    assert.strictEqual(res.status, VIDEO_STATUS.OK);
    assert.strictEqual(res.usedLkg, false);
    assert.strictEqual(res.metrics.view, 5000);
    assert.strictEqual(res.metrics.react, 300);
    assert.strictEqual(res.metrics.comment, 25);
  });

  await t.test('1 field bị lỗi (VD: react = null) -> Giữ nguyên TOÀN BỘ LKG cũ (Atomic Snapshot)', () => {
    const scrapedItem = {
      playCount: 8000, 
      diggCount: null,
      commentCount: 50
    };
    const lkg = { view: 4000, react: 200, comment: 20 };

    const res = applyAtomicSnapshot('tiktok', scrapedItem, lkg);
    assert.strictEqual(res.status, VIDEO_STATUS.PARTIAL_FIELD_ERROR);
    assert.strictEqual(res.usedLkg, true);
    assert.strictEqual(res.metrics.view, 4000);
    assert.strictEqual(res.metrics.react, 200);
    assert.strictEqual(res.metrics.comment, 20);
  });

  await t.test('Video mới chưa từng có LKG và bị lỗi cào -> Trả về PENDING_RETRY với điểm 0', () => {
    const res = applyAtomicSnapshot('tiktok', null, null, VIDEO_STATUS.TRANSIENT_ERROR);
    assert.strictEqual(res.status, VIDEO_STATUS.PENDING_RETRY);
    assert.strictEqual(res.usedLkg, false);
    assert.strictEqual(res.metrics.view, 0);
  });
});

test('lkg-fallback: updateLkgRecord & 3-day Expiry Grace Period', async (t) => {
  const t0 = new Date('2026-08-20T08:00:00Z');

  await t.test('Video bị unavailable trong vòng 2 ngày -> Vẫn giữ status CONFIRMED_UNAVAILABLE', () => {
    const oldLkg = {
      view: 10000,
      react: 500,
      comment: 80,
      status: VIDEO_STATUS.CONFIRMED_UNAVAILABLE,
      first_error_at: '2026-08-20T08:00:00Z',
      consecutive_errors: 1
    };

    const t2 = new Date('2026-08-22T08:00:00Z'); // 2 ngày sau
    const record = updateLkgRecord(oldLkg, VIDEO_STATUS.CONFIRMED_UNAVAILABLE, { view: 10000, react: 500, comment: 80 }, t2);

    assert.strictEqual(record.view, 10000);
    assert.strictEqual(record.status, VIDEO_STATUS.CONFIRMED_UNAVAILABLE);
  });

  await t.test('Video bị unavailable quá 3 ngày (72h) -> Chuyển thành STALE_EXPIRED (vẫn giữ LKG view cũ)', () => {
    const oldLkg = {
      view: 10000,
      react: 500,
      comment: 80,
      status: VIDEO_STATUS.CONFIRMED_UNAVAILABLE,
      first_error_at: '2026-08-20T08:00:00Z',
      consecutive_errors: 3
    };

    const t4 = new Date('2026-08-23T09:00:00Z'); // 3 ngày 1 giờ sau
    const record = updateLkgRecord(oldLkg, VIDEO_STATUS.CONFIRMED_UNAVAILABLE, { view: 10000, react: 500, comment: 80 }, t4);

    assert.strictEqual(record.view, 10000);
    assert.strictEqual(record.react, 500);
    assert.strictEqual(record.comment, 80);
    assert.strictEqual(record.status, VIDEO_STATUS.STALE_EXPIRED);
  });
});
