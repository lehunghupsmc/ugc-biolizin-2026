const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASELINE_PATH = path.join(__dirname, '..', '.audit-baseline.json');

function main() {
  let baseline = {};
  if (fs.existsSync(BASELINE_PATH)) {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  }
  const exceptions = baseline.exceptions || {};

  console.log('Running npm audit...');
  let auditOutput;
  try {
    auditOutput = execSync('npm audit --json', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    // npm audit returns non-zero if vulnerabilities are found
    auditOutput = err.stdout;
  }

  const auditData = JSON.parse(auditOutput);
  const vulnerabilities = auditData.vulnerabilities || {};
  
  let hasNewHighOrCritical = false;
  let hasExpiredBaseline = false;

  const now = new Date();

  for (const [pkgName, vulnObj] of Object.entries(vulnerabilities)) {
    const severity = vulnObj.severity;
    const via = vulnObj.via || [];
    
    // Find unique advisory IDs
    const advisoryIds = via.filter(v => typeof v === 'object' && v.source).map(v => v.source.toString());
    
    for (const advId of advisoryIds) {
      if (exceptions[advId]) {
        const expDate = new Date(exceptions[advId].expires_at);
        if (now > expDate) {
          console.error(`❌ Baseline exception for advisory ${advId} on ${pkgName} has EXPIRED!`);
          hasExpiredBaseline = true;
        } else {
          console.log(`✅ Advisory ${advId} on ${pkgName} is ignored until ${exceptions[advId].expires_at}.`);
        }
      } else {
        if (severity === 'high' || severity === 'critical') {
          console.error(`❌ NEW ${severity.toUpperCase()} vulnerability: Advisory ${advId} on ${pkgName}!`);
          hasNewHighOrCritical = true;
        } else {
          console.warn(`⚠️ NEW ${severity.toUpperCase()} vulnerability: Advisory ${advId} on ${pkgName} (Ignored by policy).`);
        }
      }
    }
  }

  if (hasNewHighOrCritical || hasExpiredBaseline) {
    console.error('\nAudit Failed! Please update packages or add exceptions to .audit-baseline.json');
    process.exit(1);
  } else {
    console.log('\nAudit Passed! No new high/critical vulnerabilities.');
  }
}

main();
