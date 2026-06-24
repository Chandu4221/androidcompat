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

function main() {
  const args = process.argv.slice(2);

  // Parse CLI args: --combo '{...}' --status success --run-url '...' --error-log '...'
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  const comboArg  = get('--combo');
  const status    = get('--status');    // 'success' or 'failure'
  const runUrl    = get('--run-url') || '';
  const errorLog  = get('--error-log') || '';

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
    // Update existing entry
    compatData.combinations[existingIndex] = {
      ...compatData.combinations[existingIndex],
      ...entry,
      id: compatData.combinations[existingIndex].id, // keep original id
    };
    console.log(`♻️  Updated existing entry: AGP ${combo.agp} | KSP ${combo.ksp} | Hilt ${combo.hilt} → ${entry.status}`);
  } else {
    // Add new entry
    compatData.combinations.push(entry);
    console.log(`✅ Added new entry: AGP ${combo.agp} | KSP ${combo.ksp} | Hilt ${combo.hilt} → ${entry.status}`);
  }

  saveCompat(compatData);
  console.log(`📄 compat.json updated. Total entries: ${compatData.combinations.length}`);
}

main();