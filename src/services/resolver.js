const dns = require('dns').promises;
const https = require('https');
const http = require('http');
const config = require('../config');

/**
 * Kiểm tra xem một địa chỉ IPv4 có thuộc dải mạng an toàn (Globally Routable) hay không.
 * Chặn: Private, Loopback, Link-Local, CGNAT, Multicast, Reserved, Broadcast.
 * @param {string} ip
 * @returns {boolean} true nếu là public/globally routable, false nếu là private/reserved
 */
function isGloballyRoutableIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b, c, d] = parts;

  // 0.0.0.0/8 (This network)
  if (a === 0) return false;

  // 10.0.0.0/8 (Private network - RFC 1918)
  if (a === 10) return false;

  // 100.64.0.0/10 (Carrier-grade NAT - RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return false;

  // 127.0.0.0/8 (Loopback - RFC 1122)
  if (a === 127) return false;

  // 169.254.0.0/16 (Link-local - RFC 3927)
  if (a === 169 && b === 254) return false;

  // 172.16.0.0/12 (Private network - RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return false;

  // 192.0.0.0/24 (IETF Protocol Assignments - RFC 6890)
  if (a === 192 && b === 0 && c === 0) return false;

  // 192.0.2.0/24 (TEST-NET-1 - RFC 5737)
  if (a === 192 && b === 0 && c === 2) return false;

  // 192.168.0.0/16 (Private network - RFC 1918)
  if (a === 192 && b === 168) return false;

  // 198.18.0.0/15 (Network benchmark tests - RFC 2544)
  if (a === 198 && (b === 18 || b === 19)) return false;

  // 198.51.100.0/24 (TEST-NET-2 - RFC 5737)
  if (a === 198 && b === 51 && c === 100) return false;

  // 203.0.113.0/24 (TEST-NET-3 - RFC 5737)
  if (a === 203 && b === 0 && c === 113) return false;

  // 224.0.0.0/4 (Multicast - RFC 5771)
  if (a >= 224 && a <= 239) return false;

  // 240.0.0.0/4 (Reserved for future use - RFC 1112)
  if (a >= 240) return false;

  return true;
}

/**
 * Kiểm tra xem một địa chỉ IPv6 có thuộc dải mạng an toàn (Globally Routable) hay không.
 * @param {string} ip
 * @returns {boolean}
 */
function isGloballyRoutableIPv6(ip) {
  const clean = ip.toLowerCase().trim();

  // Loopback (::1)
  if (clean === '::1' || clean === '0000:0000:0000:0000:0000:0000:0000:0001') return false;
  // Unspecified (::)
  if (clean === '::' || clean === '0000:0000:0000:0000:0000:0000:0000:0000') return false;

  // Unique Local Address fc00::/7 (fc00... hoặc fd00...)
  if (clean.startsWith('fc') || clean.startsWith('fd')) return false;

  // Link-Local fe80::/10
  if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) return false;

  // Multicast ff00::/8
  if (clean.startsWith('ff')) return false;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (clean.includes('::ffff:')) {
    const ipv4Part = clean.substring(clean.lastIndexOf(':') + 1);
    if (ipv4Part.includes('.')) {
      return isGloballyRoutableIPv4(ipv4Part);
    }
  }

  return true;
}

/**
 * Kiểm tra hostname có nằm trong allowlist hay không.
 * @param {string} hostname
 * @returns {boolean}
 */
function isAllowedDomain(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase().replace(/\.$/, ''); // Xóa trailing dot

  for (const allowed of config.ALLOWED_DOMAINS) {
    if (host === allowed || host.endsWith('.' + allowed)) {
      return true;
    }
  }
  return false;
}

/**
 * Xác thực URL an toàn trước SSRF bằng cách kiểm tra DNS và IP.
 * @param {string} targetUrl
 * @returns {Promise<{safe: boolean, reason?: string, parsedUrl?: URL}>}
 */
async function validateUrlSafety(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (err) {
    return { safe: false, reason: `Invalid URL format: ${err.message}` };
  }

  // Bắt buộc HTTPS
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}. Only HTTP/HTTPS allowed.` };
  }

  // Kiểm tra hostname Allowlist
  if (!isAllowedDomain(parsed.hostname)) {
    return { safe: false, reason: `Domain ${parsed.hostname} is not in SSRF allowlist` };
  }

  // Resolve DNS A and AAAA records
  try {
    const addresses = await dns.lookup(parsed.hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { safe: false, reason: `DNS resolution failed for ${parsed.hostname}` };
    }

    for (const addr of addresses) {
      if (addr.family === 4) {
        if (!isGloballyRoutableIPv4(addr.address)) {
          return { safe: false, reason: `Resolved IP ${addr.address} is not globally routable (Private/Reserved IP rejected)` };
        }
      } else if (addr.family === 6) {
        if (!isGloballyRoutableIPv6(addr.address)) {
          return { safe: false, reason: `Resolved IPv6 ${addr.address} is not globally routable` };
        }
      }
    }
  } catch (err) {
    return { safe: false, reason: `DNS lookup error: ${err.message}` };
  }

  return { safe: true, parsedUrl: parsed };
}

/**
 * Trích xuất platform và canonical video ID từ URL.
 * Hỗ trợ các định dạng TikTok và Facebook. Tái sử dụng isAllowedDomain.
 * @param {string} inputUrl
 * @returns {{platform: 'tiktok'|'facebook'|'unknown', videoId: string|null, canonicalUrl: string}}
 */
function extractVideoInfo(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { platform: 'unknown', videoId: null, canonicalUrl: '' };
  }

  const cleanUrl = inputUrl.trim();
  let urlObj;
  try {
    urlObj = new URL(cleanUrl);
  } catch (e) {
    return { platform: 'unknown', videoId: null, canonicalUrl: cleanUrl };
  }

  const hostname = urlObj.hostname.toLowerCase();
  const pathname = urlObj.pathname;

  if (!isAllowedDomain(hostname)) {
    return { platform: 'unknown', videoId: null, canonicalUrl: cleanUrl };
  }

  // --- TIKTOK ---
  if (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com')) {
    // Standard video: /@user/video/7525806036511444232
    // Photo slide: /@user/photo/7525806036511444232
    // /v/7525806036511444232
    const match = pathname.match(/\/(video|photo|v)\/(\d+)/i);
    if (match && match[2]) {
      return {
        platform: 'tiktok',
        videoId: match[2],
        canonicalUrl: `https://www.tiktok.com/@user/video/${match[2]}`
      };
    }

    // Short links: vt.tiktok.com/ZSxxxx/ hoặc vm.tiktok.com/ZSxxxx/
    if (hostname.startsWith('vt.') || hostname.startsWith('vm.')) {
      const code = pathname.replace(/^\/+|\/+$/g, '');
      if (code) {
        return {
          platform: 'tiktok',
          videoId: `short_${code}`,
          canonicalUrl: cleanUrl
        };
      }
    }

    return { platform: 'tiktok', videoId: null, canonicalUrl: cleanUrl };
  }

  // --- FACEBOOK ---
  if (hostname === 'facebook.com' || hostname.endsWith('.facebook.com') || hostname === 'fb.watch') {
    // /reel/1234567890/
    const reelMatch = pathname.match(/\/reel(?:s)?\/(\d+)/i);
    if (reelMatch && reelMatch[1]) {
      return {
        platform: 'facebook',
        videoId: reelMatch[1],
        canonicalUrl: `https://www.facebook.com/reel/${reelMatch[1]}/`
      };
    }

    // /videos/1234567890/
    const videoMatch = pathname.match(/\/videos\/(\d+)/i);
    if (videoMatch && videoMatch[1]) {
      return {
        platform: 'facebook',
        videoId: videoMatch[1],
        canonicalUrl: `https://www.facebook.com/watch/?v=${videoMatch[1]}`
      };
    }

    // /watch/?v=1234567890
    const vParam = urlObj.searchParams.get('v');
    if (vParam && /^\d+$/.test(vParam)) {
      return {
        platform: 'facebook',
        videoId: vParam,
        canonicalUrl: `https://www.facebook.com/watch/?v=${vParam}`
      };
    }

    // /watch/1234567890/
    const watchMatch = pathname.match(/\/watch\/(\d+)/i);
    if (watchMatch && watchMatch[1]) {
      return {
        platform: 'facebook',
        videoId: watchMatch[1],
        canonicalUrl: `https://www.facebook.com/watch/?v=${watchMatch[1]}`
      };
    }

    // Short link fb.watch/xxxx hoặc /share/v/xxxx hoặc /share/r/xxxx
    if (hostname === 'fb.watch' || pathname.includes('/share/')) {
      const shareCode = pathname.replace(/^\/+|\/+$/g, '').replace(/[\/\\]/g, '_');
      return {
        platform: 'facebook',
        videoId: `share_${shareCode}`,
        canonicalUrl: cleanUrl
      };
    }

    return { platform: 'facebook', videoId: null, canonicalUrl: cleanUrl };
  }

  return { platform: 'unknown', videoId: null, canonicalUrl: cleanUrl };
}

/**
 * Giải mã short link với cơ chế bảo vệ SSRF và tối đa 3 redirects. Tổng thời gian max 20s.
 * @param {string} originalUrl
 * @param {number} maxRedirects
 * @returns {Promise<string>} Final resolved URL
 */
async function resolveShortUrl(originalUrl, maxRedirects = 3) {
  let currentUrl = originalUrl;
  const startTime = Date.now();
  const TOTAL_TIMEOUT = 20000;

  for (let hop = 0; hop < maxRedirects; hop++) {
    if (Date.now() - startTime > TOTAL_TIMEOUT) {
      break;
    }

    const safety = await validateUrlSafety(currentUrl);
    if (!safety.safe) {
      throw new Error(`SSRF Guard Blocked URL (${currentUrl}): ${safety.reason}`);
    }

    // Nếu đã là canonical video link thì không cần resolve tiếp
    const info = extractVideoInfo(currentUrl);
    if (info.videoId && !info.videoId.startsWith('short_') && !info.videoId.startsWith('share_')) {
      return currentUrl;
    }

    try {
      const remainingTime = TOTAL_TIMEOUT - (Date.now() - startTime);
      const reqTimeout = Math.min(7000, remainingTime);

      const nextUrl = await new Promise((resolve, reject) => {
        const parsed = new URL(currentUrl);
        const req = https.request(parsed, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          timeout: reqTimeout
        }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirected = new URL(res.headers.location, currentUrl).href;
            resolve(redirected);
          } else {
            resolve(currentUrl);
          }
        });

        req.on('error', (err) => resolve(currentUrl)); // Fallback giữ URL hiện tại
        req.on('timeout', () => {
          req.destroy();
          resolve(currentUrl);
        });
        req.end();
      });

      if (nextUrl === currentUrl) {
        break;
      }
      currentUrl = nextUrl;
    } catch (e) {
      break;
    }
  }

  return currentUrl;
}

module.exports = {
  isGloballyRoutableIPv4,
  isGloballyRoutableIPv6,
  isAllowedDomain,
  validateUrlSafety,
  extractVideoInfo,
  resolveShortUrl
};
