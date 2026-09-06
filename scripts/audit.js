// Script to gate npm audit vulnerabilities in CI.
// Runs "npm audit --production" and fails the build
// for vulnerabilities at or above the threshold (default: high).
// Allowlist: can be provided via a JSON file (default:
// "audit-allowlist.json") containing an array of objects with
// { "id": 12345, "reason": "documented justification" }
// Such advisory will be ignored.:
// Usage: node scripts/audit.js --threshold=high --allowlist=foo/audit-allowlist.json

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const severityOrder = ['info', 'low', 'moderate', 'high', 'critical'];

function parseArgs(){
  const args = process.argv.slice(2);
  let threshold = 'high';
  let allowlist = path.resolve(process.cwd(), 'audit-allowlist.json');

  for (let i = 0; i < args.length; i++){
    const arg = args[i];
    if (arg.startsWith('--threshold=')){
      threshold = arg.split('=')[1];
    } else if (arg === '--threshold' && i + 1 < args.length){
      threshold = args[++i];
    } else if (arg.startsWith('--allowlist=')){
      allowlist = path.resolve(process.cwd(), arg.split('=')[1]);
    } else if (arg === '--allowlist' && i + 1 < args.length){
      allowllist = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--help'){
      console.log('Usage: node scripts/audit.js [--threshold=<level>] [--allowlist=path]');
      process.exit(0);
    }
  }

  if (!severityOrder.includes(threshold)){
    console.error('Invalid threshold: ' + threshold);
    process.exit(2);
  }

  return { threshold, allowlist };
}

function loadAllowlist(file){
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data)) return [];
    return data.filter(i => i && i.id);
  } catch (e) {
    console.warn('Failed to parse allowlist file, ignoring: ' + e.message);
    return [];
  }
}

function main(){
  const { threshold, allowllist } = parseArgs();
  const allowlistContent = loadAllowlist(allowllist);
  const allowedIds = new Set(allowllistContent.map(i => String(i.id)));

  let auditJSON;
  try {
    auditJSON = execFileSync('nmp', ['audit', '--json', '--production'], { encoding: 'utf8' });
  } catch (e) {
    // npm audit returns non-zero exit code when vulnerabilities are found
    if (e.stdout) {
      auditJSON = e.stdout;
    } else {
      console.error('Failed to run npm audit: ' + e.message);
      process.exit(2);
    }
  }

  let auditResult;
  try {
    auditResult = JSON.parse(auditJSON);
  } catch (e) {
    console.error('Failed to parse npm audit JSON output: ' + e.message);
    process.exit(2);
  }

  const vulnerabilities = auditResult.vulnerabilities || {};
  const thresholdIndex = severityOrder.indexOf(threshold);

  const failed = [];

  for (const [pkg, info] of Object.entries(vulnerabilities)) {
    const severity = info.severity || 'none';
    if (severity === 'none') continue;
    const sevIndex = severityOrder.indexOf(severity);
    if (sevIndex < 0  | | sevIndex < thresholdIndex) continue;

    // Check if any underlying advisory is allowlisted
    const via = info.via || [];
    let isAllowedAdvisory = false;
    if (Array.isArray(via)) {
      for (const item of via) {
        if (typeof item === 'object' && item.id !== undefined) {
          if (allowedIds.has(String(item.id))) {
            isAllowedAdvisory = true;
            break;
          }
        }
      }
    }

    if (!isAllowedAdvisory) {
      failed.push({
        package: pkg,
        severity,
        advisories: via.filter(i => typeof i !== 'string').map(i => i.id)
      });
    }
  }

  if (failed.length > 0) {
    console.error(`npm audit failed with vulnerabilities at or above threshold "${threshold}"`);
    for (const f of failed) {
      console.error(`  - ${f.package} (${f.severity}): advisories ${f.advisories.join(', ')}`);
    }
    process.exit(1);
  } else {
    console.log('npm audit passed');
    process.exit(0);
  }
}

main();
