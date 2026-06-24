const fs = require('fs');
const path = require('path');

const COMPAT_PATH = path.join(__dirname, '../data/compat.json');

function loadCompat() {
  if (!fs.existsSync(COMPAT_PATH)) {
    return { last_updated: new Date().toISOString(), combinations: [] };
  }
  return JSON.parse(fs.readFileSync(COMPAT_PATH, 'utf8'));
}

function saveCompat(data) {
  data.last_updated = new Date().toISOString();
  fs.writeFileSync(COMPAT_PATH, JSON.stringify(data, null, 2));
}

function findExisting(combinations, combo) {
  return combinations.findIndex(c =>
    c.agp === combo.agp &&
    c.ksp === combo.ksp &&
    c.hilt === combo.hilt &&
    c.kotlin === combo.kotlin &&
    c.gradle === combo.gradle
  );
}

function getArg(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

function mergeAllArtifacts(artifactsDir) {
  const compatData = loadCompat();
  const seen = new Set();

  compatData.combinations.forEach(c => {
    const key = `${c.agp}-${c.kotlin}-${c.ksp}-${c.hilt}-${c.gradle}`;
    seen.add(key);
  });

  const artifactFiles = [];

  function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f === 'compat.json') artifactFiles.push(full);
    });
  }

  walk(artifactsDir);
  console.log(`📦 Found ${artifactFiles.length} artifact files`);

  let added = 0;
  artifactFiles.forEach(file => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.combinations.forEach(entry => {
      const key = `${entry.agp}-${entry.kotlin}-${entry.ksp}-${entry.hilt}-${entry.gradle}`;
      if (!seen.has(key)) {
        compatData.combinations.push(entry);
        seen.add(key);
        added++;
      }
    });
  });

  saveCompat(compatData);
  console.log(`✅ Merged ${added} new entries. Total: ${compatData.combinations.length}`);
}

function main() {
  const args = process.argv.slice(2);

  // Handle merge command
  if (args[0] === '--merge-artifacts') {
    const artifactsDir = getArg(args, '--artifacts-dir') || 'artifacts';
    mergeAllArtifacts(artifactsDir);
    process.exit(0);
  }

  const comboArg = getArg(args, '--combo');
  const status   = getArg(args, '--status');
  const runUrl   = getArg(args, '--run-url') || '';
  const errorLog = getArg(args, '--error-log') || '';

  if (!comboArg || !status) {
    console.error('Usage: node update-compat.js --combo \'{...}\' --status success|failure --run-url \'...\' --error-log \'...\'');
    process.exit(1);
  }

  const combo = JSON.parse(comboArg);
  const compatData = loadCompat();

  const entry = {
    id: `combo-${Date.now()}`,
    agp:        combo.agp,
    kotlin:     combo.kotlin,
    ksp:        combo.ksp,
    hilt:       combo.hilt,
    gradle:     combo.gradle,
    composeBom: combo.composeBom || '',
    status:     status === 'success' ? 'verified' : 'broken',
    ci_run_url: runUrl,
    verified_at: new Date().toISOString(),
    error_logs:  status === 'failure' ? errorLog : '',
    notes: '',
  };

  const existingIndex = findExisting(compatData.combinations, combo);

  if (existingIndex !== -1) {
    compatData.combinations[existingIndex] = {
      ...compatData.combinations[existingIndex],
      ...entry,
      id: compatData.combinations[existingIndex].id,
    };
    console.log(`♻️  Updated: AGP ${combo.agp} | KSP ${combo.ksp} | Hilt ${combo.hilt} → ${entry.status}`);
  } else {
    compatData.combinations.push(entry);
    console.log(`✅ Added: AGP ${combo.agp} | KSP ${combo.ksp} | Hilt ${combo.hilt} → ${entry.status}`);
  }

  saveCompat(compatData);
  console.log(`📄 compat.json updated. Total entries: ${compatData.combinations.length}`);
}

main();