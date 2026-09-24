require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { ApifyClient } = require('apify-client');

const brightDataToken = process.env.BRIGHTDATA_API_TOKEN;
const apifyToken = process.env.APIFY_TOKEN;
const datasetId = 'gd_lyclm1571iy3mv57zw';
const excelInputPath = 'D:\\Download\\fb-data-2.xlsx';

const apifyClient = new ApifyClient({ token: apifyToken });

// 1. Đọc URLs từ Excel
function getUrlsFromExcel(filePath) {
  const pyScript = path.join(__dirname, 'temp_read_fb2.py');
  fs.writeFileSync(pyScript, `
import pandas as pd, json
df = pd.read_excel(r'''${filePath}''', header=None)
urls = [str(u).strip() for u in df[0].dropna().tolist() if str(u).strip().startswith('http')]
print(json.dumps(urls))
`);
  try {
    const res = execSync(`python "${pyScript}"`, { encoding: 'utf8' });
    return JSON.parse(res);
  } finally {
    if (fs.existsSync(pyScript)) fs.unlinkSync(pyScript);
  }
}

// 2. Trigger Bright Data
function triggerBrightData(urls) {
  return new Promise((resolve, reject) => {
    // Unique URLs để gửi Bright Data (tránh trùng lặp gây tốn chi phí)
    const uniqueUrls = [...new Set(urls)];
    const payload = JSON.stringify(uniqueUrls.map(url => ({ url })));
    const req = https.request({
      hostname: 'api.brightdata.com',
      path: `/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${brightDataToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 3. Poll Bright Data
function checkProgress(snapshotId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brightdata.com',
      path: `/datasets/v3/progress/${snapshotId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${brightDataToken}` },
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// 4. Download Snapshot
function downloadSnapshot(snapshotId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brightdata.com',
      path: `/datasets/v3/snapshot/${snapshotId}?format=json`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${brightDataToken}` },
      timeout: 180000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse snapshot JSON: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// 5. Giải mã redirect thủ công cho các bài nếu cần
async function resolveFacebookUrl(inputUrl) {
  try {
    const res = await fetch(inputUrl, { redirect: 'follow' });
    const finalUrl = res.url || inputUrl;
    const m = finalUrl.match(/(?:videos\/(?:[^\/]+\/)?|reel\/|watch\/\?v=)(\d{8,})/i) 
              || finalUrl.match(/(?:story_fbid=)(\d{8,})/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('================================================================');
  console.log(' BƯỚC 1: ĐỌC DANH SÁCH URL TỪ FILE EXCEL');
  console.log('================================================================\n');

  const rawUrls = getUrlsFromExcel(excelInputPath);
  console.log(`Đã đọc được ${rawUrls.length} hàng từ file Excel (trong đó có ${new Set(rawUrls).size} URL duy nhất).\n`);

  console.log('================================================================');
  console.log(' BƯỚC 2: CHẠY BRIGHT DATA ĐỂ LẤY TOÀN BỘ METADATA');
  console.log('================================================================\n');

  const triggerRes = await triggerBrightData(rawUrls);
  console.log('Trigger status:', triggerRes.statusCode);

  const snapshotId = triggerRes.data?.snapshot_id;
  if (!snapshotId) {
    console.error('LỖI: Không nhận được snapshot_id:', triggerRes);
    process.exit(1);
  }

  console.log(`Snapshot ID: ${snapshotId}. Đang đợi Bright Data xử lý...`);

  let isReady = false;
  for (let i = 1; i <= 40; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const prog = await checkProgress(snapshotId);
      const st = prog.data?.status || 'unknown';
      console.log(`[Attempt ${i}/40] Trạng thái: ${st}`);
      if (st === 'ready') {
        isReady = true;
        break;
      }
      if (st === 'failed') {
        console.error('Snapshot failed:', prog.data);
        process.exit(1);
      }
    } catch (e) {
      console.warn('Poll warn:', e.message);
    }
  }

  if (!isReady) {
    console.error('LỖI: Timeout chờ Bright Data');
    process.exit(1);
  }

  console.log('\nĐang tải snapshot từ Bright Data...');
  const brightDataResults = await downloadSnapshot(snapshotId);
  console.log(`=> Đã tải ${brightDataResults.length} bản ghi từ Bright Data.\n`);

  // Lưu bản raw Bright Data
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  const rawBrightDataFile = path.join('D:\\Download', `brightdata_fb2_raw_${timestamp}.json`);
  fs.writeFileSync(rawBrightDataFile, JSON.stringify(brightDataResults, null, 2), 'utf8');
  console.log(`Đã lưu dữ liệu thô Bright Data tại: ${rawBrightDataFile}\n`);

  // Map tra cứu dữ liệu Bright Data theo input URL
  const bdMap = new Map();
  for (const item of brightDataResults) {
    const u = item.input?.url || item.url;
    if (u) bdMap.set(u, item);
  }

  console.log('================================================================');
  console.log(' BƯỚC 3: KIỂM TRA PLAY_COUNT & XÁC ĐỊNH CÁC VIDEO CẦN CÀO BÙ');
  console.log('================================================================\n');

  const needApify = []; // list { index, inputUrl, videoId, reelUrl, bdItem }
  const alreadyHasPlayCount = [];
  const nonVideoItems = [];

  for (let idx = 0; idx < rawUrls.length; idx++) {
    const inputUrl = rawUrls[idx];
    const bdItem = bdMap.get(inputUrl);

    if (!bdItem) {
      needApify.push({ idx, inputUrl, videoId: null, bdItem: null, reason: 'No Bright Data record' });
      continue;
    }

    if (bdItem.error) {
      nonVideoItems.push({ idx, inputUrl, reason: bdItem.error, bdItem, type: 'error' });
      continue;
    }

    // Xác định có phải ảnh không
    const photoAttachment = bdItem.attachments?.find(a => a.type === 'photo');
    const videoAttachment = bdItem.attachments?.find(a => a.type === 'video');

    if (!videoAttachment && photoAttachment && bdItem.post_type !== 'Reel') {
      nonVideoItems.push({ idx, inputUrl, reason: 'Bài viết Ảnh, không có Play Count', bdItem, type: 'photo' });
      continue;
    }

    // Lấy video ID
    let videoId = videoAttachment?.id || (bdItem.post_type === 'Reel' ? bdItem.shortcode : null) || bdItem.shortcode;
    
    // Nếu chưa có Video ID (ví dụ URL dạng /share/19A6V6EaiP/), giải mã qua redirect
    if (!videoId) {
      console.log(`Đang giải mã URL ẩn ID: ${inputUrl}`);
      videoId = await resolveFacebookUrl(inputUrl);
    }

    const playCount = bdItem.play_count;
    if (playCount !== null && playCount !== undefined && playCount !== '') {
      alreadyHasPlayCount.push({ idx, inputUrl, videoId, playCount, bdItem });
    } else {
      needApify.push({ idx, inputUrl, videoId, reelUrl: videoId ? `https://www.facebook.com/reel/${videoId}` : null, bdItem });
    }
  }

  console.log(`- Tổng số URL:                              ${rawUrls.length}`);
  console.log(`- Đã có play_count từ Bright Data:          ${alreadyHasPlayCount.length}`);
  console.log(`- Thiếu play_count cần cào bù (qua Apify):  ${needApify.length}`);
  console.log(`- Bài viết dạng ảnh hoặc lỗi riêng tư:     ${nonVideoItems.length}\n`);

  // BƯỚC 4: CÀO BÙ BẰNG APIFY
  console.log('================================================================');
  console.log(' BƯỚC 4: CÀO BÙ LƯỢT XEM BẰNG APIFY (facebook-playcount-scraper)');
  console.log('================================================================\n');

  const apifyMap = new Map(); // videoId -> play_count

  const validApifyTargets = needApify.filter(n => !!n.videoId);
  if (validApifyTargets.length > 0) {
    const apifyUrls = [...new Set(validApifyTargets.map(v => `https://www.facebook.com/reel/${v.videoId}`))];
    console.log(`Gửi ${apifyUrls.length} Video Reels tới Apify scraper...`);

    const apifyRun = await apifyClient.actor('social_developer/facebook-playcount-scraper').call({
      startUrls: apifyUrls.map(url => ({ url })),
      maxConcurrency: 15,
      requestTimeoutSecs: 20,
      maxRetriesPerUrl: 3,
    }, { timeout: 180 });

    const { items: apifyItems } = await apifyClient.dataset(apifyRun.defaultDatasetId).listItems();
    console.log(`Apify đã trả về kết quả cho ${apifyItems.length} videos.`);

    for (const aItem of apifyItems) {
      if (aItem.video_id) {
        apifyMap.set(String(aItem.video_id), {
          play_count: aItem.play_count,
          status: aItem.status,
        });
      }
    }
  }

  // BƯỚC 5: HỢP NHẤT DỮ LIỆU
  console.log('\n================================================================');
  console.log(' BƯỚC 5: HỢP NHẤT DỮ LIỆU VÀ XUẤT FILE');
  console.log('================================================================\n');

  const consolidated = [];
  let totalWithPlayCount = 0;

  for (let idx = 0; idx < rawUrls.length; idx++) {
    const inputUrl = rawUrls[idx];
    const bdItem = bdMap.get(inputUrl);

    let videoId = bdItem?.attachments?.find(a => a.type === 'video')?.id 
               || (bdItem?.post_type === 'Reel' ? bdItem.shortcode : null) 
               || bdItem?.shortcode;

    // Tìm trong needApify nếu có giải mã redirect
    const na = needApify.find(n => n.idx === idx);
    if (na && na.videoId) videoId = na.videoId;

    let finalPlayCount = null;
    let sourcePlayCount = 'none';

    // 1. Kiểm tra Apify trước nếu đã cào bù
    if (videoId && apifyMap.has(String(videoId))) {
      const aData = apifyMap.get(String(videoId));
      if (aData.play_count !== null && aData.play_count !== undefined) {
        finalPlayCount = aData.play_count;
        sourcePlayCount = 'Apify';
        totalWithPlayCount++;
      }
    }

    // 2. Nếu chưa có từ Apify, lấy từ Bright Data
    if (finalPlayCount === null && bdItem?.play_count !== null && bdItem?.play_count !== undefined) {
      finalPlayCount = bdItem.play_count;
      sourcePlayCount = 'BrightData';
      totalWithPlayCount++;
    }

    // Nếu là bài ảnh hoặc lỗi
    const nonV = nonVideoItems.find(n => n.idx === idx);
    if (nonV) {
      sourcePlayCount = nonV.type;
    }

    consolidated.push({
      stt: idx + 1,
      input_url: inputUrl,
      post_id: bdItem?.post_id || null,
      video_id: videoId || null,
      reel_url: videoId ? `https://www.facebook.com/reel/${videoId}` : null,
      post_type: bdItem?.post_type || (nonV ? nonV.type : 'Unknown'),
      author_name: bdItem?.user_username_raw || null,
      author_handle: bdItem?.user_handle || bdItem?.profile_handle || null,
      author_url: bdItem?.user_url || bdItem?.page_url || null,
      play_count: finalPlayCount,
      video_view_count: bdItem?.video_view_count ?? null,
      likes: bdItem?.likes ?? 0,
      comments: bdItem?.num_comments ?? 0,
      shares: bdItem?.num_shares ?? 0,
      content: bdItem?.content || '',
      date_posted: bdItem?.date_posted || null,
      source_play_count: sourcePlayCount,
      error: bdItem?.error || null,
    });
  }

  console.log(`- Tổng số URL:                      ${consolidated.length}`);
  console.log(`- Số bài ĐÃ CÓ play_count đầy đủ:   ${totalWithPlayCount} (${((totalWithPlayCount / consolidated.length) * 100).toFixed(1)}%)`);
  console.log(`- Số bài không có play_count:       ${consolidated.length - totalWithPlayCount}`);

  // Xuất file JSON
  const jsonOut = path.join('D:\\Download', `fb_data_2_consolidated_${timestamp}.json`);
  const jsonLatest = path.join('D:\\Download', `fb_data_2_consolidated_latest.json`);
  fs.writeFileSync(jsonOut, JSON.stringify(consolidated, null, 2), 'utf8');
  fs.writeFileSync(jsonLatest, JSON.stringify(consolidated, null, 2), 'utf8');

  // Xuất file Excel bằng Python
  const excelOut = path.join('D:\\Download', `fb_data_2_consolidated_${timestamp}.xlsx`);
  const excelLatest = path.join('D:\\Download', `fb_data_2_consolidated_latest.xlsx`);

  const pyExcel = path.join(__dirname, 'temp_export_fb2.py');
  fs.writeFileSync(pyExcel, `
import json, pandas as pd
with open(r'''${jsonOut}''', 'r', encoding='utf-8') as f:
    data = json.load(f)

rows = []
for d in data:
    rows.append({
        'STT': d['stt'],
        'URL Gốc': d['input_url'],
        'Tác Giả': d['author_name'],
        'Video ID': d['video_id'],
        'Reel URL Chuẩn': d['reel_url'],
        'Loại Bài': d['post_type'],
        'Lượt Xem (Play Count)': d['play_count'],
        'Nguồn Play Count': d['source_play_count'],
        'Lượt Xem 3s (Views)': d['video_view_count'],
        'Lượt Thích (Likes)': d['likes'],
        'Bình Luận': d['comments'],
        'Chia Sẻ': d['shares'],
        'Nội Dung (Caption)': (d['content'] or '')[:120],
        'Ngày Đăng': d['date_posted'],
        'Lỗi': d['error']
    })

df = pd.DataFrame(rows)
with pd.ExcelWriter(r'''${excelOut}''', engine='openpyxl') as writer:
    df.to_excel(writer, index=False, sheet_name='FB Data 2')
with pd.ExcelWriter(r'''${excelLatest}''', engine='openpyxl') as writer:
    df.to_excel(writer, index=False, sheet_name='FB Data 2')
print("Excel exported")
`);

  try {
    execSync(`python "${pyExcel}"`, { encoding: 'utf8' });
  } finally {
    if (fs.existsSync(pyExcel)) fs.unlinkSync(pyExcel);
  }

  console.log(`\nĐÃ XUẤT THÀNH CÔNG:`);
  console.log(`1. File Excel:`);
  console.log(`   - ${excelLatest}`);
  console.log(`   - ${excelOut}`);
  console.log(`2. File JSON:`);
  console.log(`   - ${jsonLatest}`);
  console.log(`   - ${jsonOut}`);
}

main().catch(err => {
  console.error('Lỗi quy trình:', err);
  process.exit(1);
});
