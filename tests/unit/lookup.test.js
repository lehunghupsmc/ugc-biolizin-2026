const test = require('node:test');
const assert = require('node:assert');
const { classifyStatus } = require('../../api/lookup');

test('lookup: classifyStatus logic', async (t) => {
  await t.test('Ô trống hoặc null -> Tự động xếp vào Đang duyệt', () => {
    const resEmpty = classifyStatus('');
    assert.strictEqual(resEmpty.status, 'PENDING');
    assert.strictEqual(resEmpty.statusText, 'Đang duyệt');
    assert.strictEqual(resEmpty.badgeColor, '#e6a23c');

    const resNull = classifyStatus(null);
    assert.strictEqual(resNull.status, 'PENDING');
  });

  await t.test('Có note Duyệt / Hợp lệ -> Xếp vào Đã duyệt', () => {
    const res1 = classifyStatus('Duyệt');
    assert.strictEqual(res1.status, 'APPROVED');
    assert.strictEqual(res1.statusText, 'Đã duyệt');
    assert.strictEqual(res1.badgeColor, '#28a745');

    const res2 = classifyStatus('hợp lệ 100%');
    assert.strictEqual(res2.status, 'APPROVED');

    const res3 = classifyStatus('Đã duyệt bài thi');
    assert.strictEqual(res3.status, 'APPROVED');
  });

  await t.test('Có note Vi phạm / Sai thể lệ / Loại -> Xếp vào Vi phạm thể lệ', () => {
    const res1 = classifyStatus('Sai thể lệ: thiếu hashtag');
    assert.strictEqual(res1.status, 'REJECTED');
    assert.strictEqual(res1.statusText, 'Vi phạm thể lệ');
    assert.strictEqual(res1.badgeColor, '#f56c6c');
    assert.strictEqual(res1.note, 'Sai thể lệ: thiếu hashtag');

    const res2 = classifyStatus('Loại do video mờ');
    assert.strictEqual(res2.status, 'REJECTED');

    const res3 = classifyStatus('Vi phạm bản quyền');
    assert.strictEqual(res3.status, 'REJECTED');
  });

  await t.test('Note khác chưa có từ khóa đặc biệt -> Tự động đưa về Đang duyệt', () => {
    const res = classifyStatus('Chờ gửi sản phẩm kiểm tra');
    assert.strictEqual(res.status, 'PENDING');
    assert.strictEqual(res.statusText, 'Đang duyệt');
  });
});
