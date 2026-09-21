const { normalizePhoneNumber, maskPhoneNumber, createCompositeKey, parseSubmissionTimestamp } = require('./services/normalizer');
const { extractVideoInfo, resolveShortUrl } = require('./services/resolver');
const config = require('./config');

/**
 * Xử lý deduplication và tranh chấp bản quyền link video (First-Come First-Served).
 * Async pipeline: Timestamp parse -> Deadline filter -> Resolve shortlink -> Deduplicate.
 */
async function processSubmissionsAndDeduplicate(submissions) {
  const validVideos = [];
  const warnings = [];
  const nowIso = new Date().toISOString();
  
  const startAt = new Date(config.SUBMISSION_START_AT).getTime();
  const endAt = new Date(config.SUBMISSION_END_AT).getTime();

  // 1. Timestamp parse & Deadline filter
  const parsedSubs = [];
  for (const sub of submissions) {
    const parsedTime = parseSubmissionTimestamp(sub.timestamp);
    if (!parsedTime) {
      warnings.push({
        type: 'INVALID_TIMESTAMP',
        composite_key: 'N/A',
        user_name: sub.rawName,
        phone_masked: maskPhoneNumber(normalizePhoneNumber(sub.rawPhone)),
        link_raw: sub.rawLink,
        message: `Timestamp không hợp lệ: "${sub.timestamp}"`,
        detected_at: nowIso
      });
      continue;
    }

    if (parsedTime < startAt || parsedTime > endAt) {
      warnings.push({
        type: 'OUT_OF_BOUNDS',
        composite_key: 'N/A',
        user_name: sub.rawName,
        phone_masked: maskPhoneNumber(normalizePhoneNumber(sub.rawPhone)),
        link_raw: sub.rawLink,
        message: `Nằm ngoài thời gian nộp bài: ${sub.timestamp}`,
        detected_at: nowIso
      });
      continue;
    }

    parsedSubs.push({ ...sub, parsedTime });
  }

  // 2. Resolve shortlink with bounded concurrency (limit = 10)
  const resolvedSubs = [];
  for (let i = 0; i < parsedSubs.length; i += 10) {
    const chunk = parsedSubs.slice(i, i + 10);
    await Promise.all(chunk.map(async (sub) => {
      let finalLink = sub.rawLink;
      let resolveError = null;
      try {
        finalLink = await resolveShortUrl(sub.rawLink);
      } catch (err) {
        resolveError = err.message;
      }
      resolvedSubs.push({ ...sub, finalLink, resolveError });
    }));
  }

  // 3. Deduplicate
  // Sort theo First-Come First-Served: parsedTime asc, then rowIndex asc
  resolvedSubs.sort((a, b) => {
    if (a.parsedTime !== b.parsedTime) return a.parsedTime - b.parsedTime;
    return a.rowIndex - b.rowIndex;
  });

  const seenCompositeKeys = new Map();

  for (const sub of resolvedSubs) {
    const normPhone = normalizePhoneNumber(sub.rawPhone);
    if (!normPhone) {
      warnings.push({
        type: 'INVALID_PHONE',
        composite_key: 'N/A',
        user_name: sub.rawName,
        phone_masked: sub.rawPhone || 'N/A',
        link_raw: sub.rawLink,
        message: `Số điện thoại không hợp lệ: "${sub.rawPhone}"`,
        detected_at: nowIso
      });
      continue;
    }

    if (sub.isDisqualified) {
      warnings.push({
        type: 'DISQUALIFIED_BY_ADMIN',
        composite_key: 'N/A',
        user_name: sub.rawName,
        phone_masked: maskPhoneNumber(normPhone),
        link_raw: sub.rawLink,
        message: `Bị loại bởi Ban tổ chức (Cột Q: "${sub.rawStatus}") ở dòng ${sub.rowIndex}`,
        detected_at: nowIso
      });
      continue;
    }

    if (sub.resolveError) {
      warnings.push({
        type: 'SSRF_BLOCKED',
        composite_key: 'N/A',
        user_name: sub.rawName,
        phone_masked: maskPhoneNumber(normPhone),
        link_raw: sub.rawLink,
        message: `Lỗi phân giải link: ${sub.resolveError}`,
        detected_at: nowIso
      });
      continue;
    }

    const videoInfo = extractVideoInfo(sub.finalLink);
    if (videoInfo.platform === 'unknown' || !videoInfo.videoId) {
      warnings.push({
        type: 'INVALID_LINK',
        composite_key: 'N/A',
        user_name: sub.rawName,
        phone_masked: maskPhoneNumber(normPhone),
        link_raw: sub.rawLink,
        message: `Không nhận diện được link video: "${sub.finalLink}"`,
        detected_at: nowIso
      });
      continue;
    }

    const compositeKey = createCompositeKey(videoInfo.platform, videoInfo.videoId);

    if (seenCompositeKeys.has(compositeKey)) {
      const firstEntry = seenCompositeKeys.get(compositeKey);
      if (firstEntry.phone === normPhone) {
        warnings.push({
          type: 'DUPLICATE_SUBMISSION',
          composite_key: compositeKey,
          user_name: sub.rawName,
          phone_masked: maskPhoneNumber(normPhone),
          link_raw: sub.rawLink,
          message: `Thí sinh nộp trùng video ID ${videoInfo.videoId} ở dòng ${sub.rowIndex} (đã ghi nhận ở dòng ${firstEntry.rowIndex})`,
          detected_at: nowIso
        });
      } else {
        warnings.push({
          type: 'DISPUTE_FIRST_COME',
          composite_key: compositeKey,
          user_name: sub.rawName,
          phone_masked: maskPhoneNumber(normPhone),
          link_raw: sub.rawLink,
          message: `Tranh chấp video ID ${videoInfo.videoId}: Ưu tiên SĐT ${maskPhoneNumber(firstEntry.phone)} nộp trước (dòng ${firstEntry.rowIndex}). Từ chối bài nộp của ${maskPhoneNumber(normPhone)} (dòng ${sub.rowIndex}).`,
          detected_at: nowIso
        });
      }
      continue;
    }

    const entry = {
      compositeKey,
      platform: videoInfo.platform,
      videoId: videoInfo.videoId,
      phone: normPhone,
      phoneMasked: maskPhoneNumber(normPhone),
      name: sub.rawName || 'Thí sinh',
      rawLink: sub.rawLink,
      canonicalUrl: videoInfo.canonicalUrl,
      timestamp: sub.timestamp,
      rowIndex: sub.rowIndex,
      parsedTime: sub.parsedTime
    };

    seenCompositeKeys.set(compositeKey, entry);
    validVideos.push(entry);
  }

  return { validVideos, warnings };
}

function calculateRanking(contestantVideoData) {
  const contestantsMap = new Map();

  for (const item of contestantVideoData) {
    const phone = item.phone;
    if (!contestantsMap.has(phone)) {
      contestantsMap.set(phone, {
        phone,
        phoneMasked: maskPhoneNumber(phone),
        name: item.name,
        totalView: 0,
        totalReact: 0,
        totalComment: 0,
        videoCount: 0,
        primaryTimestamp: item.parsedTime || 0
      });
    }

    const contestant = contestantsMap.get(phone);
    if (item.name) contestant.name = item.name;

    contestant.totalView += (Number(item.view) || 0);
    contestant.totalReact += (Number(item.react) || 0);
    contestant.totalComment += (Number(item.comment) || 0);
    contestant.videoCount += 1;

    if (!contestant.primaryTimestamp || (item.parsedTime && item.parsedTime < contestant.primaryTimestamp)) {
      contestant.primaryTimestamp = item.parsedTime;
    }
  }

  const contestants = Array.from(contestantsMap.values());

  contestants.sort((a, b) => {
    if (b.totalView !== a.totalView) return b.totalView - a.totalView;
    const engagementA = a.totalReact + a.totalComment;
    const engagementB = b.totalReact + b.totalComment;
    if (engagementB !== engagementA) return engagementB - engagementA;
    
    if (a.primaryTimestamp && b.primaryTimestamp) {
      return a.primaryTimestamp - b.primaryTimestamp;
    }
    return 0;
  });

  const publicBxhRows = [];
  const preparedBxhRows = [];

  contestants.forEach((c, index) => {
    const rankNum = index + 1;
    let rankBadge = `${rankNum}`;
    if (rankNum === 1) rankBadge = '🥇 1';
    else if (rankNum === 2) rankBadge = '🥈 2';
    else if (rankNum === 3) rankBadge = '🥉 3';

    const userDisplay = c.phoneMasked || '098***...';
    const isoTime = c.primaryTimestamp ? new Date(c.primaryTimestamp).toISOString() : '';

    publicBxhRows.push([
      rankBadge,
      userDisplay,
      c.totalView,
      c.totalComment,
      c.totalReact
    ]);

    preparedBxhRows.push([
      rankNum,
      userDisplay,
      c.phoneMasked,
      c.totalView,
      c.totalComment,
      c.totalReact,
      c.videoCount,
      isoTime
    ]);
  });

  return { publicBxhRows, preparedBxhRows, rankedContestants: contestants };
}

module.exports = {
  processSubmissionsAndDeduplicate,
  calculateRanking
};
