const test = require('node:test');
const assert = require('node:assert');
const {
  normalizePhoneNumber,
  maskPhoneNumber,
  createCompositeKey,
  parseCompositeKey
} = require('../../src/services/normalizer');

test('normalizer: normalizePhoneNumber', async (t) => {
  await t.test('chuẩn hóa các định dạng hợp lệ về 10 số (0xxxxxxxxx)', () => {
    assert.strictEqual(normalizePhoneNumber('0912345678'), '0912345678');
    assert.strictEqual(normalizePhoneNumber('+84912345678'), '0912345678');
    assert.strictEqual(normalizePhoneNumber('84912345678'), '0912345678');
    assert.strictEqual(normalizePhoneNumber('0912 345 678'), '0912345678');
    assert.strictEqual(normalizePhoneNumber('0912.345.678'), '0912345678');
    assert.strictEqual(normalizePhoneNumber('0912-345-678'), '0912345678');
    assert.strictEqual(normalizePhoneNumber('(0912) 345 678'), '0912345678');
    assert.strictEqual(normalizePhoneNumber(912345678), '0912345678'); // Tự động bù số 0 cho số 9 chữ số đầu [3,5,7,8,9] do Google Sheet hay format thành số
    assert.strictEqual(normalizePhoneNumber('0388123456'), '0388123456');
  });

  await t.test('trả về null cho các định dạng không hợp lệ', () => {
    assert.strictEqual(normalizePhoneNumber(''), null);
    assert.strictEqual(normalizePhoneNumber(null), null);
    assert.strictEqual(normalizePhoneNumber(undefined), null);
    assert.strictEqual(normalizePhoneNumber('12345'), null);
    assert.strictEqual(normalizePhoneNumber('123456789'), null); // 9 số nhưng đầu 1 không thuộc dải di động VN
    assert.strictEqual(normalizePhoneNumber('abcdefghij'), null);
    assert.strictEqual(normalizePhoneNumber('09123456789999'), null);
  });
});

test('normalizer: maskPhoneNumber', async (t) => {
  await t.test('mask chính xác số điện thoại 10 số dạng 091***678', () => {
    assert.strictEqual(maskPhoneNumber('0912345678'), '091***678');
    assert.strictEqual(maskPhoneNumber('0388999123'), '038***123');
  });

  await t.test('xử lý chuỗi rỗng hoặc bất thường', () => {
    assert.strictEqual(maskPhoneNumber(''), '000***000');
    assert.strictEqual(maskPhoneNumber('12345'), '12***');
  });
});

test('normalizer: createCompositeKey & parseCompositeKey', async (t) => {
  await t.test('tạo và phân tách composite key chuẩn xác', () => {
    const key = createCompositeKey('TikTok', '7525806036511444232');
    assert.strictEqual(key, 'tiktok:7525806036511444232');

    const parsed = parseCompositeKey(key);
    assert.strictEqual(parsed.platform, 'tiktok');
    assert.strictEqual(parsed.videoId, '7525806036511444232');
  });

  await t.test('báo lỗi nếu thiếu tham số', () => {
    assert.throws(() => createCompositeKey('', '123'));
    assert.throws(() => createCompositeKey('facebook', ''));
  });
});
