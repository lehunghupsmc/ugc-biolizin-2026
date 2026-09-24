require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const token = process.env.BRIGHTDATA_API_TOKEN;
const datasetId = 'gd_lyclm1571iy3mv57zw';
const excelPath = 'D:\\Download\\brightdata-fb-chay-lai.xlsx';

if (!token) {
  console.error('LỖI: BRIGHTDATA_API_TOKEN không tồn tại trong môi trường .env');
  process.exit(1);
}

// Đọc danh sách URLs từ file Excel bằng Python
function getUrlsFromExcel(filePath) {
  const pyScriptPath = path.join(__dirname, 'temp_read_excel.py');
  fs.writeFileSync(pyScriptPath, `
import pandas as pd
import json

df = pd.read_excel(r'''${filePath}''', header=None)
urls = [str(u).strip() for u in df[0].dropna().tolist() if str(u).strip().startswith('http')]
print(json.dumps(urls))
`);

  try {
    const result = execSync(`python "${pyScriptPath}"`, { encoding: 'utf8' });
    return JSON.parse(result);
  } finally {
    if (fs.existsSync(pyScriptPath)) fs.unlinkSync(pyScriptPath);
  }
}

// Gửi request POST trigger dataset
function triggerBrightData(urls) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(urls.map(url => ({ url })));
    const req = https.request({
      hostname: 'api.brightdata.com',
      path: `/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 120000,
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Trigger request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

// Kiểm tra tiến độ snapshot
function checkProgress(snapshotId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brightdata.com',
      path: `/datasets/v3/progress/${snapshotId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Progress check timed out'));
    });
    req.end();
  });
}

// Tải dữ liệu kết quả từ snapshot
function downloadSnapshot(snapshotId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brightdata.com',
      path: `/datasets/v3/snapshot/${snapshotId}?format=json`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download snapshot timed out'));
    });
    req.end();
  });
}

async function main() {
  console.log('1. Đang đọc danh sách URL từ file Excel:', excelPath);
  const urls = getUrlsFromExcel(excelPath);
  console.log(`=> Đã đọc được tổng cộng ${urls.length} URLs hợp lệ.\n`);

  console.log(`2. Gửi yêu cầu cào tới Bright Data Dataset: ${datasetId}...`);
  const triggerRes = await triggerBrightData(urls);
  console.log('Trigger status:', triggerRes.statusCode);

  const snapshotId = triggerRes.data?.snapshot_id;
  if (!snapshotId) {
    console.error('LỖI: Không nhận được snapshot_id từ Bright Data:', triggerRes);
    process.exit(1);
  }

  console.log(`=> Nhận được Snapshot ID: ${snapshotId}`);
  console.log('3. Bắt đầu polling kiểm tra trạng thái snapshot (mỗi 10 giây)...\n');

  let isReady = false;
  const maxAttempts = 60; // tối đa 10 phút

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 10000));

    try {
      const progress = await checkProgress(snapshotId);
      const status = progress.data?.status || 'unknown';
      console.log(`[Attempt ${attempt}/${maxAttempts}] Trạng thái: ${status}`);

      if (status === 'ready') {
        isReady = true;
        break;
      }
      if (status === 'failed') {
        console.error('LỖI: Snapshot thất bại trên Bright Data:', progress.data);
        process.exit(1);
      }
    } catch (err) {
      console.warn(`Cảnh báo poll: ${err.message}`);
    }
  }

  if (!isReady) {
    console.error('LỖI: Quá thời gian chờ Bright Data xử lý (timeout 10 phút).');
    process.exit(1);
  }

  console.log('\n4. Đang tải kết quả JSON từ Bright Data...');
  const items = await downloadSnapshot(snapshotId);
  console.log(`=> Đã tải thành công ${items.length} bản ghi dữ liệu!\n`);

  // Lưu file kết quả JSON
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const localFile = path.join(outputDir, `brightdata_fb_results_${timestamp}.json`);
  const downloadFile = path.join('D:\\Download', `brightdata_fb_results_${timestamp}.json`);

  fs.writeFileSync(localFile, JSON.stringify(items, null, 2), 'utf8');
  fs.writeFileSync(downloadFile, JSON.stringify(items, null, 2), 'utf8');
  console.log(`5. Đã lưu file kết quả JSON tại:`);
  console.log(`   - Dự án: ${localFile}`);
  console.log(`   - Download: ${downloadFile}\n`);

  // 6. Phân tích kết quả kiểm tra Play Count
  console.log('========================================================');
  console.log(' BÁO CÁO PHÂN TÍCH PLAY COUNT TỪ KẾT QUẢ BRIGHT DATA');
  console.log('========================================================');

  let countWithPlayCount = 0;
  let countWithoutPlayCount = 0;
  let countErrors = 0;

  const missingPlayCountList = [];
  const successList = [];

  // Tạo map từ items để tra cứu theo input URL
  const itemMap = new Map();
  for (const it of items) {
    const inputU = it.input?.url || it.url;
    if (inputU) {
      itemMap.set(inputU, it);
    }
  }

  for (const url of urls) {
    const it = itemMap.get(url);
    if (!it) {
      countWithoutPlayCount++;
      missingPlayCountList.push({
        url,
        reason: 'Không có dữ liệu trả về từ scraper',
        error: null,
        post_type: null,
      });
      continue;
    }

    if (it.error || it.status === 'error') {
      countErrors++;
      countWithoutPlayCount++;
      missingPlayCountList.push({
        url,
        reason: 'Lỗi từ scraper Facebook',
        error: it.error || it.message || 'Scraper error',
        post_type: it.post_type,
      });
      continue;
    }

    const playCount = it.play_count;
    const viewCount = it.video_view_count;

    if (playCount !== null && playCount !== undefined && playCount !== '') {
      countWithPlayCount++;
      successList.push({
        url,
        play_count: playCount,
        video_view_count: viewCount,
        likes: it.likes,
        post_type: it.post_type,
        shortcode: it.shortcode || it.post_id,
      });
    } else {
      countWithoutPlayCount++;
      missingPlayCountList.push({
        url,
        reason: 'play_count là null / không lấy được',
        video_view_count: viewCount,
        likes: it.likes,
        post_type: it.post_type,
        shortcode: it.shortcode || it.post_id,
      });
    }
  }

  console.log(`Tổng số URL kiểm tra:          ${urls.length}`);
  console.log(`Số URL LẤY ĐƯỢC play_count:     ${countWithPlayCount} (${((countWithPlayCount / urls.length) * 100).toFixed(1)}%)`);
  console.log(`Số URL KHÔNG LẤY ĐƯỢC play_count: ${countWithoutPlayCount} (${((countWithoutPlayCount / urls.length) * 100).toFixed(1)}%)`);
  if (countErrors > 0) {
    console.log(`Trong đó có ${countErrors} URL gặp lỗi trực tiếp (bài viết riêng tư, bị xóa hoặc không truy cập được).`);
  }

  // Lưu riêng báo cáo các URL lỗi ra file JSON để người dùng dễ kiểm tra
  const reportPath = path.join('D:\\Download', `fb_missing_playcount_report_${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    summary: {
      total: urls.length,
      success_count: countWithPlayCount,
      missing_count: countWithoutPlayCount,
      error_count: countErrors,
    },
    missing_items: missingPlayCountList,
    success_items: successList,
  }, null, 2), 'utf8');

  console.log(`\n=> Báo cáo chi tiết đã được lưu tại: ${reportPath}`);
}

main().catch(err => {
  console.error('Unhandled error in script:', err);
  process.exit(1);
});
