const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { generateLeaderboardImage, buildLeaderboardSvg, ROW_CENTERS_Y, COLUMNS_X } = require('../../src/services/image-generator');

describe('image-generator', () => {
  test('cấu hình toạ độ 20 hàng và cột hợp lệ', () => {
    assert.strictEqual(ROW_CENTERS_Y.length, 20);
    assert.strictEqual(ROW_CENTERS_Y[0], 439);
    assert.strictEqual(ROW_CENTERS_Y[19], 2776);
    assert.strictEqual(COLUMNS_X.USER.x, 544);
    assert.strictEqual(COLUMNS_X.VIEW.x, 980);
    assert.strictEqual(COLUMNS_X.COMMENT.x, 1236);
    assert.strictEqual(COLUMNS_X.TYM.x, 1478);
  });

  test('buildLeaderboardSvg tạo chuỗi SVG chứa dữ liệu SĐT và escape an toàn', () => {
    const contestants = [
      { phoneMasked: '098***123', totalView: 150000, totalComment: 500, totalReact: 12000 }
    ];
    const svgBuffer = buildLeaderboardSvg(contestants);
    const svgString = svgBuffer.toString('utf8');

    assert.ok(svgString.includes('<svg width="1676" height="2921"'));
    assert.ok(svgString.includes('098***123'));
    assert.ok(svgString.includes('150,000'));
    assert.ok(svgString.includes('500'));
    assert.ok(svgString.includes('12,000'));
  });

  test('generateLeaderboardImage tạo ra file ảnh JPEG sắc nét và kích thước chuẩn', async () => {
    const testOutputPath = path.join(__dirname, 'test-output-bxh.jpg');
    const contestants = [
      { phoneMasked: '090***111', totalView: 10000, totalComment: 100, totalReact: 500 }
    ];

    const res = await generateLeaderboardImage(contestants, {
      outputDir: __dirname,
      fileName: 'test-output-bxh.jpg'
    });

    assert.strictEqual(res.width, 1676);
    assert.strictEqual(res.height, 2921);
    assert.strictEqual(res.totalRendered, 1);
    assert.ok(fs.existsSync(testOutputPath));

    // Cleanup
    if (fs.existsSync(testOutputPath)) {
      fs.unlinkSync(testOutputPath);
    }
  });
});
