const fs = require("fs");
const path = require("path");
const { parseFailure } = require("./parse-failure");
const { scoreConfidence } = require("./score-confidence");

const COMPAT_PATH = path.join(__dirname, "../data/compat.json");

function loadCompat() {
  if (!fs.existsSync(COMPAT_PATH)) {
    return { last_updated: new Date().toISOString(), combinations: [] };
  }
  return JSON.parse(fs.readFileSync(COMPAT_PATH, "utf8"));
}

function saveCompat(data) {
  data.last_updated = new Date().toISOString();
  fs.writeFileSync(COMPAT_PATH, JSON.stringify(data, null, 2));
}

function findExisting(combinations, combo) {
  return combinations.findIndex(
    (c) =>
      c.agp === combo.agp &&
      c.ksp === combo.ksp &&
      c.hilt === combo.hilt &&
      c.kotlin === combo.kotlin &&
      c.gradle === combo.gradle,
  );
}

function getArg(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

function mergeAllArtifacts(artifactsDir) {
  if (!fs.existsSync(artifactsDir)) {
    console.log("⚠️ No artifacts directory found. Nothing to merge.");
    process.exit(0);
  }
  const compatData = loadCompat();
  const seen = new Set();

  compatData.combinations.forEach((c) => {
    const key = `${c.agp}-${c.kotlin}-${c.ksp}-${c.hilt}-${c.gradle}`;
    seen.add(key);
  });

  const artifactFiles = [];

  function walk(dir) {
    fs.readdirSync(dir).forEach((f) => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f === "compat.json") artifactFiles.push(full);
    });
  }

  walk(artifactsDir);
  console.log(`📦 Found ${artifactFiles.length} artifact files`);

  let added = 0;
  artifactFiles.forEach((file) => {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.combinations.forEach((entry) => {
      const key = `${entry.agp}-${entry.kotlin}-${entry.ksp}-${entry.hilt}-${entry.gradle}`;
      if (!seen.has(key)) {
        compatData.combinations.push(entry);
        seen.add(key);
        added++;
      }
    });
  });

  saveCompat(compatData);
  console.log(
    `✅ Merged ${added} new entries. Total: ${compatData.combinations.length}`,
  );
}

function deriveStatus(args) {
  const sync = getArg(args, "--sync-status");
  const compile = getArg(args, "--compile-status");
  const unit = getArg(args, "--unit-test-status");
  if (sync === "failure") return "broken_sync";
  if (compile === "failure") return "broken_compile";
  if (unit === "failure") return "broken_unit_test";
  if (unit === "success") return "verified";
  if (compile === "success") return "partial"; // compiled but no tests
  return "unknown";
}

function main() {
  const args = process.argv.slice(2);

  // Handle merge command
  if (args[0] === "--merge-artifacts") {
    const artifactsDir = getArg(args, "--artifacts-dir") || "artifacts";
    mergeAllArtifacts(artifactsDir);
    process.exit(0);
  }

  const comboArg = getArg(args, "--combo");
  const runUrl = getArg(args, "--run-url") || "";
  const syncStatus = getArg(args, "--sync-status");
  const errorLog = getArg(args, "--error-log") || "";

  if (!comboArg || !syncStatus) {
    console.error(
      "Usage: node update-compat.js --combo '{...}' --sync-status ... --compile-status ...",
    );
    process.exit(1);
  }
  const combo = JSON.parse(comboArg);
  const compatData = loadCompat();

  const entry = {
    id: `combo-${Date.now()}`,
    agp: combo.agp,
    kotlin: combo.kotlin,
    ksp: combo.ksp,
    hilt: combo.hilt,
    gradle: combo.gradle,
    composeBom: combo.composeBom || "",

    // Replace single `status` with this:
    verification: {
      sync: getArg(args, "--sync-status") || "skipped",
      compile: getArg(args, "--compile-status") || "skipped",
      unit_test: getArg(args, "--unit-test-status") || "skipped",
      instrumentation: getArg(args, "--instrumentation-status") || "skipped",
    },
    // Overall status derived
    status: deriveStatus(args),

    ci_run_url: runUrl,
    verified_at: new Date().toISOString(),
    error_log: errorLog,
    failure_analysis: parseFailure(errorLog),
    confidence: null,
    notes: "",
  };

  entry.confidence = scoreConfidence(entry);

  const existingIndex = findExisting(compatData.combinations, combo);

  if (existingIndex !== -1) {
    compatData.combinations[existingIndex] = {
      ...compatData.combinations[existingIndex],
      ...entry,
      id: compatData.combinations[existingIndex].id,
    };
    console.log(
      `♻️  Updated: AGP ${combo.agp} | KSP ${combo.ksp} | Hilt ${combo.hilt} → ${entry.status}`,
    );
  } else {
    compatData.combinations.push(entry);
    console.log(
      `✅ Added: AGP ${combo.agp} | KSP ${combo.ksp} | Hilt ${combo.hilt} → ${entry.status}`,
    );
  }

  saveCompat(compatData);
  console.log(
    `📄 compat.json updated. Total entries: ${compatData.combinations.length}`,
  );
}

main();
