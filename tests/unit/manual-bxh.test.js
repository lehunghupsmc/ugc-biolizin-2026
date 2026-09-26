const test = require('node:test');
const assert = require('node:assert');
const { isRowApproved, parseMetric } = require('../../src/manual-bxh');

test('manual-bxh: isRowApproved', async (t) => {
  await t.test('Chấp nhận các nhãn hợp lệ', () => {
    assert.strictEqual(isRowApproved('Hợp lệ'), true);
    assert.strictEqual(isRowApproved('hợp lệ'), true);
    assert.strictEqual(isRowApproved('Đã duyệt'), true);
    assert.strictEqual(isRowApproved('Đạt'), true);
    assert.strictEqual(isRowApproved('Approved'), true);
  });

  await t.test('Từ chối các nhãn không hợp lệ hoặc vi phạm', () => {
    assert.strictEqual(isRowApproved('Không hợp lệ'), false);
    assert.strictEqual(isRowApproved('Vi phạm thể lệ'), false);
    assert.strictEqual(isRowApproved('Sai thể lệ'), false);
    assert.strictEqual(isRowApproved('Bị loại'), false);
    assert.strictEqual(isRowApproved('Hủy bài'), false);
    assert.strictEqual(isRowApproved('Chờ duyệt'), false);
    assert.strictEqual(isRowApproved(''), false);
    assert.strictEqual(isRowApproved(null), false);
    assert.strictEqual(isRowApproved(undefined), false);
  });
});

test('manual-bxh: parseMetric', async (t) => {
  await t.test('Parse số nguyên từ chuỗi hoặc số an toàn', () => {
    assert.strictEqual(parseMetric('155'), 155);
    assert.strictEqual(parseMetric('1,250'), 1250);
    assert.strictEqual(parseMetric('6.051'), 6051);
    assert.strictEqual(parseMetric(200), 200);
    assert.strictEqual(parseMetric(''), 0);
    assert.strictEqual(parseMetric(null), 0);
    assert.strictEqual(parseMetric(undefined), 0);
    assert.strictEqual(parseMetric('abc'), 0);
  });
});
