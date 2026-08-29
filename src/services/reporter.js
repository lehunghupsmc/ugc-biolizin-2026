const fs = require('fs');
const https = require('https');

/**
 * Tạo Markdown báo cáo tổng kết lượt chạy (Run Summary).
 * @param {object} stats
 * @returns {string} Markdown text
 */
function buildSummaryMarkdown(stats) {
  const {
    runId = 'N/A',
    action = 'daily',
    startedAt = new Date().toISOString(),
    completedAt = new Date().toISOString(),
    totalSubmissions = 0,
    uniqueVideos = 0,
    okCount = 0,
    lkgFallbackCount = 0,
    errorCount = 0,
    pendingCount = 0,
    top5 = [],
    warnings = [],
    contestStatus = 'ACTIVE',
    runStatus = 'PUBLISHED'
  } = stats;

  let md = `## 🏆 UGC Biolizin Contest Tracker - Run Summary\n\n`;
  md += `* **Run ID:** \`${runId}\`\n`;
  md += `* **Action:** \`${action}\` | **Contest Status:** \`${contestStatus}\` | **Run Status:** \`${runStatus}\`\n`;
  md += `* **Thời gian:** \`${startedAt}\` ➔ \`${completedAt}\`\n\n`;

  md += `### 📊 Thống kê Dữ liệu\n\n`;
  md += `| Chỉ số | Số lượng |\n`;
  md += `| :--- | :---: |\n`;
  md += `| Tổng số dòng đăng ký Form | **${totalSubmissions}** |\n`;
  md += `| Tổng video hợp lệ (Deduplicated) | **${uniqueVideos}** |\n`;
  md += `| Cào mới thành công (OK) | **${okCount}** ✅ |\n`;
  md += `| Giữ nguyên LKG cũ (Fallback) | **${lkgFallbackCount}** 🛡️ |\n`;
  md += `| Lỗi / Đang chờ xử lý | **${errorCount + pendingCount}** ⚠️ |\n\n`;

  if (top5 && top5.length > 0) {
    md += `### 🥇 Top 5 Thí sinh dẫn đầu\n\n`;
    md += `| Hạng | Thí sinh | Tổng View | Tổng Comment | Tổng React |\n`;
    md += `| :---: | :--- | :---: | :---: | :---: |\n`;
    for (const r of top5) {
      md += `| ${r[0]} | ${r[1]} | ${Number(r[2]).toLocaleString('en-US')} | ${Number(r[3]).toLocaleString('en-US')} | ${Number(r[4]).toLocaleString('en-US')} |\n`;
    }
    md += `\n`;
  }

  if (warnings && warnings.length > 0) {
    md += `### ⚠️ Cảnh báo nghiệp vụ (${warnings.length})\n\n`;
    for (const w of warnings.slice(0, 10)) {
      md += `- **[${w.type}]** ${w.message} *(Key: \`${w.composite_key}\`)*\n`;
    }
    if (warnings.length > 10) {
      md += `- *...và còn ${warnings.length - 10} cảnh báo khác trong tab Canh_Bao.*\n`;
    }
    md += `\n`;
  }

  return md;
}

/**
 * Ghi GitHub Step Summary ra file môi trường của GitHub Actions.
 * @param {object} stats
 */
function publishGithubSummary(stats) {
  const md = buildSummaryMarkdown(stats);
  console.log('\n--- RUN SUMMARY ---\n' + md + '\n-------------------\n');

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
    } catch (e) {
      console.warn('Could not write to GITHUB_STEP_SUMMARY:', e.message);
    }
  }
}

/**
 * Tự động tạo Issue cảnh báo khi chạy thất bại (có kiểm tra chống spam trong 24h).
 */
async function alertOnFailure({ errorMessage, repo, token, runId }) {
  if (!repo || !token) {
    console.log('[Reporter] No GitHub repository or token provided. Skipping auto Issue creation.');
    return;
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const title = `🚨 Contest Tracker FAILED - ${dateStr}`;

  try {
    // 1. Kiểm tra issue trùng trong 24h
    const existingIssues = await new Promise((resolve, reject) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const req = https.request({
        hostname: 'api.github.com',
        path: `/repos/${repo}/issues?state=open&creator=app/github-actions&since=${since}`,
        method: 'GET',
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'UGC-Contest-Tracker',
          'Accept': 'application/vnd.github.v3+json'
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve([]);
          }
        });
      });
      req.on('error', () => resolve([]));
      req.end();
    });

    const isDuplicate = Array.isArray(existingIssues) && existingIssues.some(iss => iss.title && iss.title.includes('Contest Tracker FAILED'));
    if (isDuplicate) {
      console.log('[Reporter] Duplicate failure issue exists within 24 hours. Skipping creation.');
      return;
    }

    // 2. Tạo issue mới
    const issueBody = `### 🚨 Daily UGC Contest Tracker Workflow FAILED\n\n**Run ID:** ${runId}\n**Timestamp:** ${new Date().toISOString()}\n\n**Error Details:**\n\`\`\`\n${errorMessage}\n\`\`\`\n\nVui lòng kiểm tra tab Actions trên GitHub repository để xem log chi tiết.`;

    await new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        title,
        body: issueBody,
        labels: ['bug', 'automated-alert']
      });

      const req = https.request({
        hostname: 'api.github.com',
        path: `/repos/${repo}/issues`,
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'UGC-Contest-Tracker',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let resBody = '';
        res.on('data', chunk => resBody += chunk);
        res.on('end', () => resolve(resBody));
      });

      req.on('error', (err) => {
        console.warn('[Reporter] Failed to create GitHub issue:', err.message);
        resolve(null);
      });

      req.write(payload);
      req.end();
    });

    console.log('[Reporter] Created GitHub failure alert Issue.');
  } catch (err) {
    console.warn('[Reporter] Error in alertOnFailure:', err.message);
  }
}

module.exports = {
  buildSummaryMarkdown,
  publishGithubSummary,
  alertOnFailure
};
