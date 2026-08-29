const test = require('node:test');
const assert = require('node:assert');
const { computeCanonicalPublicHash } = require('../../src/services/lkg-store');

test('two-phase-sync: computeCanonicalPublicHash', async (t) => {
  await t.test('tính toán SHA-256 hash chuẩn xác và nhất quán', () => {
    const payload1 = [
      ['🥇 1', 'Nguyễn Văn A (091***678)', 500000, 450, 3750],
      ['🥈 2', 'Trần Thị B (098***234)', 250000, 200, 1500]
    ];

    const hash1 = computeCanonicalPublicHash(payload1);
    const hash2 = computeCanonicalPublicHash(payload1);

    assert.strictEqual(typeof hash1, 'string');
    assert.strictEqual(hash1.length, 64);
    assert.strictEqual(hash1, hash2); // Tính bất biến
  });

  await t.test('hash thay đổi khi dữ liệu bảng thay đổi', () => {
    const payload1 = [['🥇 1', 'Nguyễn Văn A', 500000, 450, 3750]];
    const payload2 = [['🥇 1', 'Nguyễn Văn A', 500001, 450, 3750]]; // view đổi 1 đơn vị

    const hash1 = computeCanonicalPublicHash(payload1);
    const hash2 = computeCanonicalPublicHash(payload2);

    assert.notStrictEqual(hash1, hash2);
  });
});
