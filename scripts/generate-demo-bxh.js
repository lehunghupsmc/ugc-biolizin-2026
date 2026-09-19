const path = require('path');
const { generateLeaderboardImage } = require('../src/services/image-generator');

// 20 thí sinh chỉ hiển thị SĐT che mờ (098***123)
const demoContestants = [
  { phoneMasked: '098***123', totalView: 245600, totalComment: 1240, totalReact: 18900 },
  { phoneMasked: '091***456', totalView: 198320, totalComment: 980, totalReact: 15400 },
  { phoneMasked: '097***789', totalView: 176500, totalComment: 850, totalReact: 12100 },
  { phoneMasked: '090***321', totalView: 154200, totalComment: 720, totalReact: 10500 },
  { phoneMasked: '096***654', totalView: 132000, totalComment: 640, totalReact: 9200 },
  { phoneMasked: '093***111', totalView: 118500, totalComment: 590, totalReact: 8400 },
  { phoneMasked: '094***222', totalView: 105200, totalComment: 510, totalReact: 7800 },
  { phoneMasked: '098***333', totalView: 98400, totalComment: 480, totalReact: 7100 },
  { phoneMasked: '091***444', totalView: 92100, totalComment: 450, totalReact: 6700 },
  { phoneMasked: '097***555', totalView: 86500, totalComment: 410, totalReact: 6200 },
  { phoneMasked: '090***666', totalView: 81000, totalComment: 390, totalReact: 5800 },
  { phoneMasked: '096***777', totalView: 75600, totalComment: 360, totalReact: 5300 },
  { phoneMasked: '093***888', totalView: 70200, totalComment: 330, totalReact: 4900 },
  { phoneMasked: '094***999', totalView: 65800, totalComment: 310, totalReact: 4500 },
  { phoneMasked: '098***001', totalView: 61400, totalComment: 290, totalReact: 4200 },
  { phoneMasked: '091***002', totalView: 57000, totalComment: 270, totalReact: 3900 },
  { phoneMasked: '097***003', totalView: 53200, totalComment: 250, totalReact: 3600 },
  { phoneMasked: '090***004', totalView: 49800, totalComment: 230, totalReact: 3300 },
  { phoneMasked: '096***005', totalView: 46500, totalComment: 210, totalReact: 3000 },
  { phoneMasked: '093***006', totalView: 43200, totalComment: 190, totalReact: 2800 }
];

async function main() {
  console.log('Generating demo leaderboard image (Phone only: 098***123)...');
  const result = await generateLeaderboardImage(demoContestants);
  console.log('Result:', result);
}

main().catch(console.error);
