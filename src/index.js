const config = require('./config');
const googleSheet = require('./services/google-sheet');
const { processSubmissionsAndDeduplicate, calculateRanking } = require('./ranking');
const { applyAtomicSnapshot } = require('./services/metric-mapper');
const { computeCanonicalPublicHash, updateLkgRecord } = require('./services/lkg-store');
const { publishGithubSummary, alertOnFailure } = require('./services/reporter');
const { scrapeTikTokBatch } = require('./scrapers/tiktok');
const { scrapeFacebookBatch } = require('./scrapers/facebook');

function parseArgs() {
  const args = process.argv.slice(2);
  let action = 'daily';
  for (const arg of args) {
    if (arg.startsWith('--action=')) {
      action = arg.split('=')[1];
    }
  }
  return { action };
}

async function main() {
  const { action } = parseArgs();
  const startTime = new Date();
  const runId = `run-${startTime.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

  console.log(`[Main] ==========================================`);
  console.log(`[Main] Starting UGC Biolizin Tracker - Run ID: ${runId}`);
  console.log(`[Main] Action: ${action} | Time: ${startTime.toISOString()}`);
  console.log(`[Main] ==========================================`);

  let sheets;
  try {
    sheets = googleSheet.getSheetsClient();
  } catch (err) {
    console.error('[Main] Google Sheets auth initialization failed:', err.message);
    await alertOnFailure({
      errorMessage: `Auth Failed: ${err.message}`,
      repo: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      runId
    });
    process.exit(1);
  }

  const sourceSheetId = config.GOOGLE_SOURCE_SHEET_ID;
  const internalSheetId = config.GOOGLE_INTERNAL_SHEET_ID;
  const publicSheetId = config.GOOGLE_PUBLIC_SHEET_ID;

  try {
    // 1. Đảm bảo các tab cần thiết trên Sheet Internal đã tồn tại
    await googleSheet.ensureInternalTabsExist(sheets, internalSheetId);

    // 2. Đọc System_Meta
    const meta = await googleSheet.readSystemMeta(sheets, internalSheetId);
    const contestStatus = meta.CONTEST_STATUS || config.CONTEST_STATUS.ACTIVE;
    const runStatus = meta.RUN_STATUS || config.RUN_STATUS.IDLE;

    console.log(`[Main] Current State => CONTEST_STATUS: ${contestStatus} | RUN_STATUS: ${runStatus}`);

    // --- RECOVERY LOGIC (2-Phase Recovery) ---
    if (runStatus === config.RUN_STATUS.PREPARED) {
      console.log(`[Main] ♻️ Detected PREPARED status from previous run. Retrying Phase 2 Publish...`);
      const preparedRows = await googleSheet.readPreparedBxh(sheets, internalSheetId);
      if (preparedRows && preparedRows.length > 0) {
        // Chuyển đổi Prepared_BXH sang định dạng Public: [Hạng, User, View, Comment, React]
        const publicRows = preparedRows.map((r, idx) => {
          const rankBadge = idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : `${idx + 1}`;
          return [rankBadge, r[1], r[3], r[4], r[5]];
        });

        await googleSheet.writePhase2Public(sheets, publicSheetId, publicRows);
        await googleSheet.confirmPhase3Published(sheets, internalSheetId, runId);
        console.log(`[Main] ✅ Successfully recovered and published BXH to Public Sheet!`);
      }
    }

    // --- CONTEST FROZEN CHECK ---
    if (contestStatus === config.CONTEST_STATUS.FROZEN && action === 'daily') {
      console.log(`[Main] ⏹️ Contest is FROZEN. Skipping daily scrape.`);
      publishGithubSummary({
        runId,
        action,
        startedAt: startTime.toISOString(),
        completedAt: new Date().toISOString(),
        contestStatus: 'FROZEN',
        runStatus: 'SKIPPED'
      });
      return;
    }

    // 3. Đọc dữ liệu Sheet Nguồn (Form)
    console.log(`[Main] 📥 Reading Source Form submissions...`);
    const submissions = await googleSheet.readSourceFormSubmissions(sheets, sourceSheetId);
    console.log(`[Main] Read ${submissions.length} raw submissions from Form.`);

    // 4. Chuẩn hóa & Deduplicate (First-Come First-Served)
    const { validVideos, warnings } = await processSubmissionsAndDeduplicate(submissions);
    console.log(`[Main] Valid unique videos: ${validVideos.length} | Warnings: ${warnings.length}`);

    // 5. Đọc LKG Cache cũ
    const lkgMap = await googleSheet.readLkgState(sheets, internalSheetId);

    // 6. Phân nhóm video theo platform để cào
    const tiktokVideos = validVideos.filter(v => v.platform === 'tiktok');
    const facebookVideos = validVideos.filter(v => v.platform === 'facebook');

    console.log(`[Main] Scraping batch: ${tiktokVideos.length} TikTok | ${facebookVideos.length} Facebook...`);

    const [tiktokResults, facebookResults] = await Promise.all([
      scrapeTikTokBatch(tiktokVideos.map(v => v.rawLink)),
      scrapeFacebookBatch(facebookVideos.map(v => v.rawLink))
    ]);

    // 7. Xử lý Atomic Snapshot & LKG cho từng video
    const lkgRows = [];
    const chiTietRows = [];
    const contestantScoredVideos = [];
    let okCount = 0;
    let lkgFallbackCount = 0;
    let errorCount = 0;
    let pendingCount = 0;

    const now = new Date();
    const nowIso = now.toISOString();

    for (const v of validVideos) {
      const existingLkg = lkgMap.get(v.compositeKey) || null;
      let scrapeRes;

      if (v.platform === 'tiktok') {
        scrapeRes = tiktokResults.get(v.rawLink) || { ok: false, errorType: config.VIDEO_STATUS.TRANSIENT_ERROR };
      } else if (v.platform === 'facebook') {
        scrapeRes = facebookResults.get(v.rawLink) || { ok: false, errorType: config.VIDEO_STATUS.TRANSIENT_ERROR };
      } else {
        scrapeRes = { ok: false, errorType: config.VIDEO_STATUS.AMBIGUOUS_ERROR };
      }

      const snapshot = applyAtomicSnapshot(
        v.platform,
        scrapeRes.ok ? scrapeRes.data : null,
        existingLkg ? { view: existingLkg.view, react: existingLkg.react, comment: existingLkg.comment } : null,
        !scrapeRes.ok ? scrapeRes.errorType : null
      );

      const lkgRecord = updateLkgRecord(existingLkg, snapshot.status, snapshot.metrics, now);

      if (snapshot.status === config.VIDEO_STATUS.OK) {
        okCount++;
      } else if (snapshot.usedLkg) {
        lkgFallbackCount++;
      } else if (snapshot.status === config.VIDEO_STATUS.PENDING_RETRY) {
        pendingCount++;
      } else {
        errorCount++;
      }

      // Cảnh báo nếu video lỗi liên tiếp / hết hạn ân hạn
      if (lkgRecord.status === config.VIDEO_STATUS.STALE_EXPIRED) {
        warnings.push({
          type: 'STALE_EXPIRED',
          composite_key: v.compositeKey,
          user_name: v.name,
          phone_masked: v.phoneMasked,
          link_raw: v.rawLink,
          message: `Video lỗi liên tiếp > 3 ngày (${snapshot.status}). Điểm đã được reset về 0.`,
          detected_at: nowIso
        });
      }

      // Hàng cho tab LKG_State:
      // [composite_key, platform, canonical_video_id, phone, user_name, view, react, comment, status, last_successful_at, consecutive_errors, first_error_at, updated_at]
      lkgRows.push([
        v.compositeKey,
        v.platform,
        v.videoId,
        v.phone,
        v.name,
        lkgRecord.view,
        lkgRecord.react,
        lkgRecord.comment,
        lkgRecord.status,
        lkgRecord.last_successful_at,
        lkgRecord.consecutive_errors,
        lkgRecord.first_error_at,
        lkgRecord.updated_at
      ]);

      // Hàng cho tab Chi_Tiet:
      // [composite_key, platform, user_name, phone_raw, phone_masked, link_raw, canonical_url, status, view, react, comment, is_lkg, error_details, updated_at]
      chiTietRows.push([
        v.compositeKey,
        v.platform,
        v.name,
        v.phone,
        v.phoneMasked,
        v.rawLink,
        v.canonicalUrl,
        snapshot.status,
        lkgRecord.view,
        lkgRecord.react,
        lkgRecord.comment,
        snapshot.usedLkg ? 'YES' : 'NO',
        snapshot.errorDetails || '',
        nowIso
      ]);

      contestantScoredVideos.push({
        phone: v.phone,
        name: v.name,
        timestamp: v.timestamp,
        view: lkgRecord.view,
        react: lkgRecord.react,
        comment: lkgRecord.comment
      });
    }

    // Hàng cho tab Canh_Bao:
    // [type, composite_key, user_name, phone_masked, link_raw, message, detected_at]
    const canhBaoRows = warnings.map(w => [
      w.type,
      w.composite_key,
      w.user_name,
      w.phone_masked,
      w.link_raw,
      w.message,
      w.detected_at
    ]);

    // 8. Tính điểm & Sắp xếp BXH
    const { publicBxhRows, preparedBxhRows, rankedContestants } = calculateRanking(contestantScoredVideos);
    const payloadHash = computeCanonicalPublicHash(publicBxhRows);

    const runHistoryRow = [
      runId,
      startTime.toISOString(),
      new Date().toISOString(),
      action,
      validVideos.length,
      okCount,
      lkgFallbackCount,
      errorCount,
      pendingCount,
      payloadHash,
      config.RUN_STATUS.PREPARED,
      ''
    ];

    // 9. PHASE 1: Ghi Internal Sheet (Atomic Batch Update)
    if (action === 'finalize') {
      console.log(`[Main] 🛑 Checking Finalize Gate Blockers...`);
      const blockers = [];
      for (const row of lkgRows) {
        const compositeKey = row[0];
        const status = row[8];
        if (status !== config.VIDEO_STATUS.OK && status !== config.VIDEO_STATUS.RESET_APPROVED) {
          blockers.push({ compositeKey, status });
        }
      }

      if (blockers.length > 0) {
        console.error(`[Main] Finalize Gate blocked by ${blockers.length} unresolved videos.`);
        for (const b of blockers) {
          console.error(`  - ${b.compositeKey}: ${b.status}`);
        }
        
        throw new Error(`Finalize Gate blocked by ${blockers.length} unresolved videos (not OK or RESET_APPROVED).`);
      }
      console.log(`[Main] ✅ Finalize Gate Passed! Proceeding to Freeze.`);
    }

    console.log(`[Main] 1️⃣ Phase 1: Writing Internal Sheet tabs (LKG, Chi_Tiet, Canh_Bao, Prepared_BXH)...`);
    await googleSheet.writePhase1Internal({
      sheets,
      spreadsheetId: internalSheetId,
      lkgRows,
      chiTietRows,
      canhBaoRows,
      preparedBxhRows,
      runHistoryRow,
      preparedMeta: {
        PREPARED_RUN_ID: runId,
        PREPARED_AT: nowIso,
        PREPARED_PAYLOAD_HASH: payloadHash,
        CONTEST_STATUS: action === 'finalize' ? config.CONTEST_STATUS.FROZEN : contestStatus,
        FROZEN_AT: action === 'finalize' ? nowIso : (meta.FROZEN_AT || ''),
        FROZEN_BY: action === 'finalize' ? (process.env.GITHUB_ACTOR || 'BTC') : (meta.FROZEN_BY || '')
      }
    });

    // 10. PHASE 2: Ghi Public Sheet (BXH công khai)
    console.log(`[Main] 2️⃣ Phase 2: Writing Public BXH Sheet (${publicBxhRows.length} contestants)...`);
    await googleSheet.writePhase2Public(sheets, publicSheetId, publicBxhRows);

    // 11. PHASE 3: Xác nhận PUBLISHED
    console.log(`[Main] 3️⃣ Phase 3: Confirming PUBLISHED status in System_Meta...`);
    await googleSheet.confirmPhase3Published(sheets, internalSheetId, runId);

    const completedTime = new Date();

    // 12. Xuất báo cáo tổng kết
    publishGithubSummary({
      runId,
      action,
      startedAt: startTime.toISOString(),
      completedAt: completedTime.toISOString(),
      totalSubmissions: submissions.length,
      uniqueVideos: validVideos.length,
      okCount,
      lkgFallbackCount,
      errorCount,
      pendingCount,
      top5: publicBxhRows.slice(0, 5),
      warnings,
      contestStatus: action === 'finalize' ? 'FROZEN' : contestStatus,
      runStatus: config.RUN_STATUS.PUBLISHED
    });

    console.log(`[Main] 🚀 Run completed successfully in ${(completedTime - startTime) / 1000}s!`);
  } catch (err) {
    console.error(`[Main] ❌ Fatal error in execution:`, err);
    await alertOnFailure({
      errorMessage: err.stack || err.message,
      repo: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      runId
    });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
