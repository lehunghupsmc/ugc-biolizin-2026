const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

function getServiceAccountCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.trim();
      if (raw.startsWith('{')) {
        return JSON.parse(raw);
      }
      // Check base64
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch (err) {
      console.warn('Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY env var:', err.message);
    }
  }

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || path.join(process.cwd(), 'ugc-biolizin-key.json');
  if (fs.existsSync(keyPath)) {
    return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  }

  return null;
}

module.exports = {
  // Scraper tokens
  APIFY_TOKEN: process.env.APIFY_TOKEN || '',
  BRIGHTDATA_API_TOKEN: process.env.BRIGHTDATA_API_TOKEN || '',

  // Google Sheet IDs
  GOOGLE_SOURCE_SHEET_ID: process.env.GOOGLE_SOURCE_SHEET_ID || '1Jq3oI6IMKEnjVYt5cJWB_-eTPp2Y6OmNvHzE31qsM1U',
  GOOGLE_INTERNAL_SHEET_ID: process.env.GOOGLE_INTERNAL_SHEET_ID || '15b81tOh75d1kSTISx_979YyqVaO1qB937dwwQlILoGY',
  GOOGLE_PUBLIC_SHEET_ID: process.env.GOOGLE_PUBLIC_SHEET_ID || '1lfPR7LTD3FOWC7oGW2rqtNLOetaePSBB14axUEFrARE',
  SOURCE_TAB_NAME: process.env.GOOGLE_SOURCE_TAB_NAME || 'gop_du_lieu',
  SOURCE_RANGE: process.env.GOOGLE_SOURCE_RANGE || 'M:Q',

  // Contest timeline
  CONTEST_START_AT: process.env.CONTEST_START_AT || '2026-08-01T00:00:00+07:00',
  CONTEST_END_AT: process.env.CONTEST_END_AT || '2026-09-30T23:59:59+07:00',
  SUBMISSION_START_AT: process.env.SUBMISSION_START_AT || '2026-08-01T00:00:00+07:00',
  SUBMISSION_END_AT: process.env.SUBMISSION_END_AT || '2026-09-30T23:59:59+07:00',
  SCORING_CUTOFF_AT: process.env.SCORING_CUTOFF_AT || '2026-09-30T23:59:59+07:00',
  TIMEZONE: 'Asia/Ho_Chi_Minh',

  // Tab Names
  TABS: {
    INTERNAL_LKG: 'LKG_State',
    INTERNAL_CHI_TIET: 'Chi_Tiet',
    INTERNAL_CANH_BAO: 'Canh_Bao',
    INTERNAL_PREPARED: 'Prepared_BXH',
    INTERNAL_RUN_HISTORY: 'Run_History',
    INTERNAL_APPROVAL_AUDIT: 'Approval_Audit',
    INTERNAL_SYSTEM_META: 'System_Meta',
    PUBLIC_BXH: 'BXH'
  },

  // Contest & Run Status Enums
  CONTEST_STATUS: {
    ACTIVE: 'ACTIVE',
    FROZEN: 'FROZEN',
    AWAITING_MANUAL_APPROVAL: 'AWAITING_MANUAL_APPROVAL'
  },

  RUN_STATUS: {
    IDLE: 'IDLE',
    PREPARED: 'PREPARED',
    PUBLISHED: 'PUBLISHED'
  },

  VIDEO_STATUS: {
    OK: 'OK',
    PARTIAL_FIELD_ERROR: 'PARTIAL_FIELD_ERROR',
    TRANSIENT_ERROR: 'TRANSIENT_ERROR',
    CONFIRMED_UNAVAILABLE: 'CONFIRMED_UNAVAILABLE',
    CONFIRMED_SENSITIVE: 'CONFIRMED_SENSITIVE',
    STALE_EXPIRED: 'STALE_EXPIRED',
    RESET_APPROVED: 'RESET_APPROVED',
    AMBIGUOUS_ERROR: 'AMBIGUOUS_ERROR',
    PENDING_RETRY: 'PENDING_RETRY'
  },

  // SSRF Allowed Hosts
  ALLOWED_DOMAINS: [
    'tiktok.com',
    'facebook.com',
    'fb.watch'
  ],

  getServiceAccountCredentials
};
