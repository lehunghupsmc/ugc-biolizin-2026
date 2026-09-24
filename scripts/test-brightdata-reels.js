require('dotenv').config();
const https = require('https');

const token = process.env.BRIGHTDATA_API_TOKEN;
const datasetId = 'gd_lyclm1571iy3mv57zw'; // Facebook Posts / Reels Scraper

async function testBrightData(urls) {
  console.log(`\n========================================`);
  console.log(`Triggering Bright Data Dataset: ${datasetId}`);
  console.log(`URLs to scrape:`, urls);
  console.log(`========================================\n`);

  const payload = JSON.stringify(urls.map(url => ({ url })));

  const triggerRes = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brightdata.com',
      path: `/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  console.log('Trigger response:', triggerRes);
  const snapshotId = triggerRes.data?.snapshot_id;
  if (!snapshotId) {
    console.error('No snapshot_id returned');
    return;
  }

  console.log(`Snapshot ID: ${snapshotId}. Polling for progress...`);

  let isReady = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 10000)); // wait 10s

    const progressRes = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.brightdata.com',
        path: `/datasets/v3/progress/${snapshotId}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000,
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

    console.log(`Attempt ${i + 1}: status = ${progressRes.data?.status}`);

    if (progressRes.data?.status === 'ready') {
      isReady = true;
      break;
    }
    if (progressRes.data?.status === 'failed') {
      console.error('Snapshot failed:', progressRes.data);
      return;
    }
  }

  if (!isReady) {
    console.error('Timeout waiting for snapshot');
    return;
  }

  // Download snapshot data
  const snapshotRes = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brightdata.com',
      path: `/datasets/v3/snapshot/${snapshotId}?format=json`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 30000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ raw: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });

  console.log('\n=== BRIGHT DATA RESULT ===');
  console.log(JSON.stringify(snapshotRes, null, 2));
}

// Test with both the share URLs and the direct reel URLs
testBrightData([
  'https://www.facebook.com/share/r/19PSfWGzLW/?mibextid=wwXIfr',
  'https://www.facebook.com/share/r/18pkuGy6xH/?mibextid=wwXIfr',
  'https://www.facebook.com/reel/28209425325388636',
  'https://www.facebook.com/reel/1080266861074047',
]).catch(console.error);
