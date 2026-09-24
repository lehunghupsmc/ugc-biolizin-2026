const test = require('node:test');
const assert = require('node:assert');
const https = require('https');
const { scrapeFacebookBatch } = require('../../src/scrapers/facebook');
const config = require('../../src/config');

test('Bright Data Lifecycle - should handle starting -> running -> 429 -> ready flow', async (t) => {
  config.BRIGHTDATA_API_TOKEN = 'mock-token';
  const urls = ['https://www.facebook.com/watch/?v=123'];
  
  let callIndex = 0;
  t.mock.method(https, 'request', (options, callback) => {
    callIndex++;
    
    let res;
    if (callIndex === 1) { // Trigger
      res = {
        statusCode: 200,
        headers: {},
        on: (event, handler) => {
          if (event === 'data') handler(JSON.stringify({ snapshot_id: 'snap123' }));
          if (event === 'end') handler();
        }
      };
    } else if (callIndex === 2) { // Progress 1: starting
      res = {
        statusCode: 200,
        headers: {},
        on: (event, handler) => {
          if (event === 'data') handler(JSON.stringify({ status: 'starting' }));
          if (event === 'end') handler();
        }
      };
    } else if (callIndex === 3) { // Progress 2: 429
      res = {
        statusCode: 429,
        headers: { 'retry-after': '1' },
        on: (event, handler) => {
          if (event === 'data') handler('');
          if (event === 'end') handler();
        }
      };
    } else if (callIndex === 4) { // Progress 3: ready
      res = {
        statusCode: 200,
        headers: {},
        on: (event, handler) => {
          if (event === 'data') handler(JSON.stringify({ status: 'ready' }));
          if (event === 'end') handler();
        }
      };
    } else if (callIndex === 5) { // Snapshot data
      res = {
        statusCode: 200,
        headers: {},
        on: (event, handler) => {
          if (event === 'data') handler(JSON.stringify([{ url: urls[0], video_view_count: 100 }]));
          if (event === 'end') handler();
        }
      };
    }

    // Call the callback asynchronously to simulate real request
    setTimeout(() => callback(res), 10);
    
    return { 
      on: () => {}, 
      write: () => {}, 
      end: () => {} 
    };
  });

  // Ghi đè setTimeout gốc để chạy nhanh hơn (không dùng FakeTimers vì phức tạp với node:test native)
  const origSetTimeout = setTimeout;
  t.mock.method(global, 'setTimeout', (fn, delay) => {
    // Chuyển delay dài thành delay rất ngắn để test chạy nhanh
    const fastDelay = Math.min(delay, 10); 
    return Reflect.apply(origSetTimeout, global, [fn, fastDelay]);
  });

  const results = await scrapeFacebookBatch(urls);
  assert.strictEqual(results.get(urls[0]).ok, true);
  assert.strictEqual(results.get(urls[0]).data.video_view_count, 100);
});
