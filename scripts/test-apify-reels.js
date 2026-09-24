require('dotenv').config();
const { ApifyClient } = require('apify-client');

const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

/**
 * Tự động giải mã link share/r/ rút gọn của Facebook để lấy URL gốc, Video ID và Profile URL
 */
async function resolveFacebookUrl(inputUrl) {
  try {
    // Không dùng browser User-Agent để Facebook tự động trả về 302 Redirect Location
    const res = await fetch(inputUrl, { redirect: 'follow' });
    const finalUrl = res.url || inputUrl;
    
    // Tìm video ID từ URL sau redirect
    // Cấu trúc: /videos/.../28209425325388636/ hoặc /reel/28209425325388636 hoặc ?v=28209425325388636
    const m = finalUrl.match(/(?:videos\/(?:[^\/]+\/)?|reel\/|watch\/\?v=)(\d{8,})/i) 
              || finalUrl.match(/(?:story_fbid=)(\d{8,})/);
    const videoId = m ? m[1] : null;

    // Tìm profile url từ URL sau redirect
    let profileUrl = null;
    const pm = finalUrl.match(/facebook\.com\/([a-zA-Z0-9._-]+)\/(?:videos|posts)/i);
    if (pm && !['reel', 'watch', 'share'].includes(pm[1])) {
      profileUrl = `https://www.facebook.com/${pm[1]}`;
    }

    return {
      inputUrl,
      finalUrl,
      videoId,
      reelUrl: videoId ? `https://www.facebook.com/reel/${videoId}` : null,
      profileUrl,
    };
  } catch (error) {
    console.error(`[resolveFacebookUrl] Lỗi khi giải mã URL ${inputUrl}:`, error.message);
    return {
      inputUrl,
      finalUrl: inputUrl,
      videoId: null,
      reelUrl: null,
      profileUrl: null,
    };
  }
}

async function main() {
  const inputUrls = [
    'https://www.facebook.com/share/r/19PSfWGzLW/?mibextid=wwXIfr',
    'https://www.facebook.com/share/r/18pkuGy6xH/?mibextid=wwXIfr',
  ];

  console.log('========================================================');
  console.log(' BƯỚC 1: GIẢI MÃ LIÊN KẾT SHARE RÚT GỌN (FACEBOOK)');
  console.log('========================================================\n');
  const resolvedList = [];
  for (const url of inputUrls) {
    const resolved = await resolveFacebookUrl(url);
    console.log(`- Input:    ${resolved.inputUrl}`);
    console.log(`  Target:   ${resolved.finalUrl.slice(0, 90)}...`);
    console.log(`  Video ID: ${resolved.videoId}`);
    console.log(`  Reel URL: ${resolved.reelUrl}`);
    console.log(`  Profile:  ${resolved.profileUrl}\n`);
    resolvedList.push(resolved);
  }

  // PHƯƠNG PHÁP 1: Dùng social_developer/facebook-playcount-scraper
  // Chuyên lấy số lượt xem (play count) trực tiếp từ URL reel, tốc độ cực nhanh
  console.log('========================================================');
  console.log(' PHƯƠNG PHÁP 1: LẤY SỐ VIEW QUA FACEBOOK PLAYCOUNT SCRAPER');
  console.log(' (social_developer/facebook-playcount-scraper)');
  console.log('========================================================\n');
  const reelUrls = resolvedList.map(r => ({ url: r.reelUrl })).filter(r => !!r.url);
  
  if (reelUrls.length > 0) {
    const playcountRun = await client.actor('social_developer/facebook-playcount-scraper').call({
      startUrls: reelUrls,
    }, { timeout: 60 });

    const { items: playCountResults } = await client.dataset(playcountRun.defaultDatasetId).listItems();
    console.log('Kết quả số lượt xem:');
    console.table(playCountResults.map(item => ({
      url: item.url,
      video_id: item.video_id,
      play_count: item.play_count,
      status: item.status,
    })));
  }

  // PHƯƠNG PHÁP 2: Dùng apify/facebook-reels-scraper
  // Yêu cầu URL Profile/Page, cào đầy đủ thông số: view count, caption, duration, tải video...
  console.log('\n========================================================');
  console.log(' PHƯƠNG PHÁP 2: QUÉT BẰNG apify/facebook-reels-scraper');
  console.log(' (Quét theo Profile để lấy full metadata và play count)');
  console.log('========================================================\n');
  const profileUrls = [...new Set(resolvedList.map(r => r.profileUrl).filter(Boolean))];
  
  if (profileUrls.length > 0) {
    const reelsScraperRun = await client.actor('apify/facebook-reels-scraper').call({
      startUrls: profileUrls.map(url => ({ url })),
      resultsLimit: 5,
    }, { timeout: 120 });

    const { items: allReels } = await client.dataset(reelsScraperRun.defaultDatasetId).listItems();
    const targetIds = resolvedList.map(r => r.videoId);
    const matchedReels = allReels.filter(item => targetIds.includes(item.video?.id));
    
    console.log(`Đã cào được ${allReels.length} reels, khớp ${matchedReels.length} video mục tiêu:\n`);
    matchedReels.forEach(item => {
      console.log(`- Video ID: ${item.video?.id}`);
      console.log(`  Lượt xem (playCountRounded): ${item.playCountRounded}`);
      console.log(`  Thời lượng: ${item.playback_video?.length_in_second} giây`);
      console.log(`  Tác giả: ${item.video_owner?.name} (${item.video_owner?.url})`);
      console.log(`  Thời gian đăng: ${item.time}`);
      console.log(`  Reel Link: ${item.topLevelReelUrl}`);
      console.log('---');
    });
  }
}

main().catch(console.error);
