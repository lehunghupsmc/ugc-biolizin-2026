const test = require('node:test');
const assert = require('node:assert');
const {
  isGloballyRoutableIPv4,
  isGloballyRoutableIPv6,
  isAllowedDomain,
  extractVideoInfo
} = require('../../src/services/resolver');

test('resolver: isGloballyRoutableIPv4 (SSRF Guard)', async (t) => {
  await t.test('chấp nhận các IP Public toàn cầu', () => {
    assert.strictEqual(isGloballyRoutableIPv4('8.8.8.8'), true);
    assert.strictEqual(isGloballyRoutableIPv4('1.1.1.1'), true);
    assert.strictEqual(isGloballyRoutableIPv4('157.240.22.35'), true);
  });

  await t.test('chặn các IP Private, Loopback, Link-Local, CGNAT, Broadcast', () => {
    assert.strictEqual(isGloballyRoutableIPv4('127.0.0.1'), false); // Loopback
    assert.strictEqual(isGloballyRoutableIPv4('10.0.0.1'), false); // Private 10/8
    assert.strictEqual(isGloballyRoutableIPv4('192.168.1.1'), false); // Private 192.168/16
    assert.strictEqual(isGloballyRoutableIPv4('172.16.0.1'), false); // Private 172.16/12
    assert.strictEqual(isGloballyRoutableIPv4('169.254.169.254'), false); // AWS/GCP Metadata
    assert.strictEqual(isGloballyRoutableIPv4('100.64.0.1'), false); // CGNAT
    assert.strictEqual(isGloballyRoutableIPv4('0.0.0.0'), false);
    assert.strictEqual(isGloballyRoutableIPv4('224.0.0.1'), false); // Multicast
    assert.strictEqual(isGloballyRoutableIPv4('240.0.0.1'), false); // Reserved
  });
});

test('resolver: isGloballyRoutableIPv6 (SSRF Guard)', async (t) => {
  await t.test('chặn Loopback ::1 và Unique Local', () => {
    assert.strictEqual(isGloballyRoutableIPv6('::1'), false);
    assert.strictEqual(isGloballyRoutableIPv6('fe80::1'), false);
    assert.strictEqual(isGloballyRoutableIPv6('fc00::1'), false);
  });
});

test('resolver: isAllowedDomain', async (t) => {
  await t.test('chấp nhận các domain và subdomain trong allowlist', () => {
    assert.strictEqual(isAllowedDomain('tiktok.com'), true);
    assert.strictEqual(isAllowedDomain('www.tiktok.com'), true);
    assert.strictEqual(isAllowedDomain('vt.tiktok.com'), true);
    assert.strictEqual(isAllowedDomain('facebook.com'), true);
    assert.strictEqual(isAllowedDomain('m.facebook.com'), true);
    assert.strictEqual(isAllowedDomain('fb.watch'), true);
  });

  await t.test('từ chối các domain ngoài allowlist', () => {
    assert.strictEqual(isAllowedDomain('youtube.com'), false);
    assert.strictEqual(isAllowedDomain('attacker.com'), false);
    assert.strictEqual(isAllowedDomain('evil-tiktok.com'), false);
  });
});

test('resolver: extractVideoInfo', async (t) => {
  await t.test('trích xuất đúng platform và ID từ link TikTok', () => {
    const res1 = extractVideoInfo('https://www.tiktok.com/@biolizin/video/7525806036511444232');
    assert.strictEqual(res1.platform, 'tiktok');
    assert.strictEqual(res1.videoId, '7525806036511444232');

    const res2 = extractVideoInfo('https://vt.tiktok.com/ZSjRxxx/');
    assert.strictEqual(res2.platform, 'tiktok');
    assert.match(res2.videoId, /short_/);
  });

  await t.test('trích xuất đúng platform và ID từ link Facebook', () => {
    const res1 = extractVideoInfo('https://www.facebook.com/reel/123456789012345/');
    assert.strictEqual(res1.platform, 'facebook');
    assert.strictEqual(res1.videoId, '123456789012345');

    const res2 = extractVideoInfo('https://www.facebook.com/watch/?v=9876543210');
    assert.strictEqual(res2.platform, 'facebook');
    assert.strictEqual(res2.videoId, '9876543210');
  });
});
