require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ApifyClient } = require('apify-client');

const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

const brightDataFile = 'D:\\Download\\brightdata_fb_results_20260922_152110.json';
const excelSourceFile = 'D:\\Download\\brightdata-fb-chay-lai.xlsx';

async function main() {
  console.log('================================================================');
  console.log(' BƯỚC 1: ĐỌC DỮ LIỆU BRIGHT DATA ĐÃ QUÉT');
  console.log('================================================================\n');

  if (!fs.existsSync(brightDataFile)) {
    throw new Error(`Không tìm thấy file: ${brightDataFile}`);
  }

  const brightDataItems = JSON.parse(fs.readFileSync(brightDataFile, 'utf8'));
  console.log(`Đã nạp ${brightDataItems.length} bản ghi từ Bright Data.\n`);

  // Trích xuất Video ID cho từng bài
  console.log('================================================================');
  console.log(' BƯỚC 2: TRÍCH XUẤT VIDEO ID & CHUẨN BỊ URL CÀO BÙ VIEW BẰNG APIFY');
  console.log('================================================================\n');

  const videoTargets = []; // { index, inputUrl, videoId, reelUrl, brightDataItem }
  const nonVideoTargets = [];

  brightDataItems.forEach((it, idx) => {
    const inputUrl = it.input?.url || it.url;
    
    // Kiểm tra lỗi chết trang
    if (it.error) {
      nonVideoTargets.push({
        idx,
        inputUrl,
        reason: it.error || 'Bài viết không tồn tại / riêng tư',
        type: 'error',
        item: it,
      });
      return;
    }

    // Kiểm tra nếu là bài ảnh
    const photoAttachment = it.attachments?.find(a => a.type === 'photo');
    const videoAttachment = it.attachments?.find(a => a.type === 'video');

    if (!videoAttachment && photoAttachment && it.post_type !== 'Reel') {
      nonVideoTargets.push({
        idx,
        inputUrl,
        reason: 'Bài viết dạng Ảnh (Photo), không có Play Count',
        type: 'photo',
        item: it,
      });
      return;
    }

    // Lấy Video ID: ưu tiên id trong video attachment, fallback shortcode
    const videoId = videoAttachment?.id || (it.post_type === 'Reel' ? it.shortcode : null) || it.shortcode;
    
    if (videoId) {
      videoTargets.push({
        idx,
        inputUrl,
        videoId,
        reelUrl: `https://www.facebook.com/reel/${videoId}`,
        item: it,
      });
    } else {
      nonVideoTargets.push({
        idx,
        inputUrl,
        reason: 'Không xác định được Video ID',
        type: 'unknown',
        item: it,
      });
    }
  });

  console.log(`- Tổng số video hợp lệ cần cào Play Count: ${videoTargets.length}`);
  console.log(`- Số bài không phải video (ảnh hoặc lỗi):     ${nonVideoTargets.length}\n`);

  // Gọi Apify actor: social_developer/facebook-playcount-scraper
  console.log('================================================================');
  console.log(' BƯỚC 3: GỌI APIFY (facebook-playcount-scraper) CÀO BÙ TOÀN BỘ VIEW');
  console.log('================================================================\n');

  const apifyStartUrls = videoTargets.map(v => ({ url: v.reelUrl }));
  console.log(`Bắt đầu chạy actor Apify với ${apifyStartUrls.length} URL Reels...`);

  const run = await client.actor('social_developer/facebook-playcount-scraper').call({
    startUrls: apifyStartUrls,
    maxConcurrency: 15,
    requestTimeoutSecs: 20,
    maxRetriesPerUrl: 3,
  }, { timeout: 300 });

  console.log(`Run status: ${run.status}`);
  console.log(`Dataset ID: ${run.defaultDatasetId}`);

  const { items: apifyItems } = await client.dataset(run.defaultDatasetId).listItems();
  console.log(`=> Apify đã trả về kết quả cho ${apifyItems.length} videos!\n`);

  // Tạo Map tra cứu play_count từ Apify theo video_id
  const playCountMap = new Map();
  for (const aItem of apifyItems) {
    if (aItem.video_id) {
      playCountMap.set(String(aItem.video_id), {
        play_count: aItem.play_count,
        status: aItem.status,
      });
    }
  }

  // BƯỚC 4: HỢP NHẤT DỮ LIỆU BRIGHT DATA + APIFY
  console.log('================================================================');
  console.log(' BƯỚC 4: HỢP NHẤT DỮ LIỆU TỔNG HỢP');
  console.log('================================================================\n');

  const consolidatedList = [];
  let successPlayCount = 0;
  let failPlayCount = 0;

  for (let i = 0; i < brightDataItems.length; i++) {
    const it = brightDataItems[i];
    const inputUrl = it.input?.url || it.url;

    // Tìm trong videoTargets
    const target = videoTargets.find(v => v.idx === i);
    let finalPlayCount = null;
    let playCountStatus = 'not_attempted';
    let videoId = null;

    if (target) {
      videoId = target.videoId;
      const apifyRes = playCountMap.get(String(videoId));
      if (apifyRes && apifyRes.play_count !== null && apifyRes.play_count !== undefined) {
        finalPlayCount = apifyRes.play_count;
        playCountStatus = 'apify_ok';
        successPlayCount++;
      } else if (it.play_count !== null && it.play_count !== undefined) {
        // Fallback sang Bright Data play_count nếu Apify null
        finalPlayCount = it.play_count;
        playCountStatus = 'brightdata_ok';
        successPlayCount++;
      } else {
        failPlayCount++;
        playCountStatus = apifyRes?.status || 'play_count_not_found';
      }
    } else {
      const nonV = nonVideoTargets.find(n => n.idx === i);
      playCountStatus = nonV?.type || 'non_video';
    }

    consolidatedList.push({
      stt: i + 1,
      input_url: inputUrl,
      post_id: it.post_id || null,
      video_id: videoId,
      reel_url: videoId ? `https://www.facebook.com/reel/${videoId}` : null,
      post_type: it.post_type || (it.error ? 'Error' : 'Unknown'),
      author_name: it.user_username_raw || null,
      author_handle: it.user_handle || it.profile_handle || null,
      author_url: it.user_url || it.page_url || null,
      play_count: finalPlayCount,
      video_view_count: it.video_view_count ?? null,
      likes: it.likes ?? 0,
      comments: it.num_comments ?? 0,
      shares: it.num_shares ?? 0,
      content: it.content || '',
      date_posted: it.date_posted || null,
      header_image: it.header_image || null,
      play_count_status: playCountStatus,
      error: it.error || null,
      raw_brightdata: it,
    });
  }

  console.log(`- Tổng số bài:                       ${consolidatedList.length}`);
  console.log(`- Số bài LẤY ĐƯỢC play_count sau bù: ${successPlayCount} (${((successPlayCount / consolidatedList.length) * 100).toFixed(1)}%)`);
  console.log(`- Số bài không lấy được play_count:  ${failPlayCount + nonVideoTargets.length}`);
  console.log(`  + Trong đó bài dạng ảnh/lỗi:        ${nonVideoTargets.length}`);
  console.log(`  + Trong đó video không rõ view:     ${failPlayCount}\n`);

  // BƯỚC 5: XUẤT FILE JSON VÀ EXCEL
  console.log('================================================================');
  console.log(' BƯỚC 5: LƯU CÁC FILE KẾT QUẢ TỔNG HỢP');
  console.log('================================================================\n');

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // 1. File JSON đầy đủ
  const jsonDownloadPath = path.join('D:\\Download', `facebook_ugc_consolidated_${timestamp}.json`);
  const jsonLatestPath = path.join('D:\\Download', `facebook_ugc_consolidated_latest.json`);
  const jsonLocalPath = path.join(__dirname, '..', 'output', `facebook_ugc_consolidated_${timestamp}.json`);

  fs.writeFileSync(jsonDownloadPath, JSON.stringify(consolidatedList, null, 2), 'utf8');
  fs.writeFileSync(jsonLatestPath, JSON.stringify(consolidatedList, null, 2), 'utf8');
  fs.writeFileSync(jsonLocalPath, JSON.stringify(consolidatedList, null, 2), 'utf8');

  // 2. Xuất file Excel bằng Python pandas để xem dạng bảng
  const excelDownloadPath = path.join('D:\\Download', `facebook_ugc_consolidated_${timestamp}.xlsx`);
  const excelLatestPath = path.join('D:\\Download', `facebook_ugc_consolidated_latest.xlsx`);

  const pyExportScript = path.join(__dirname, 'temp_export_excel.py');
  fs.writeFileSync(pyExportScript, `
import json
import pandas as pd

with open(r'''${jsonDownloadPath}''', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Chọn các cột hiển thị đẹp trên Excel
rows = []
for d in data:
    rows.append({
        'STT': d['stt'],
        'URL Gốc Dự Thi': d['input_url'],
        'Tác Giả': d['author_name'],
        'Handle': d['author_handle'],
        'Video ID': d['video_id'],
        'Reel URL Chuẩn': d['reel_url'],
        'Loại Bài': d['post_type'],
        'Lượt Xem (Play Count)': d['play_count'],
        'Lượt Xem 3s (Views)': d['video_view_count'],
        'Lượt Thích (Likes)': d['likes'],
        'Bình Luận': d['comments'],
        'Chia Sẻ': d['shares'],
        'Nội Dung (Caption)': (d['content'] or '')[:150],
        'Ngày Đăng': d['date_posted'],
        'Trạng Thái Play Count': d['play_count_status'],
        'Lỗi': d['error']
    })

df = pd.DataFrame(rows)
with pd.ExcelWriter(r'''${excelDownloadPath}''', engine='openpyxl') as writer:
    df.to_excel(writer, index=False, sheet_name='Facebook UGC Data')

with pd.ExcelWriter(r'''${excelLatestPath}''', engine='openpyxl') as writer:
    df.to_excel(writer, index=False, sheet_name='Facebook UGC Data')

print("Excel exported successfully")
`);

  try {
    execSync(`python "${pyExportScript}"`, { encoding: 'utf8' });
  } finally {
    if (fs.existsSync(pyExportScript)) fs.unlinkSync(pyExportScript);
  }

  console.log(`Đã xuất thành công các file:`);
  console.log(`1. File JSON tổng hợp (Đầy đủ mọi trường):`);
  console.log(`   - ${jsonDownloadPath}`);
  console.log(`   - ${jsonLatestPath}`);
  console.log(`2. File Excel tổng hợp (Trực quan, dễ lọc):`);
  console.log(`   - ${excelDownloadPath}`);
  console.log(`   - ${excelLatestPath}`);
}

main().catch(err => {
  console.error('Unhandled error in consolidation:', err);
  process.exit(1);
});
