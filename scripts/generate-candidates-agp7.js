require("dotenv").config();
const fs = require("fs");
const path = require("path");

const REGISTRY_PATH = path.join(__dirname, "../data/version-registry.json");
const COMPAT_PATH = path.join(__dirname, "../data/compat.json");
const CANDIDATES_PATH = path.join(
  __dirname,
  "../data/combos-to-test-agp7.json",
);
const RULES_PATH = path.join(__dirname, "../data/rules.json");

// ── Load Rules ────────────────────────────────────────────────────────────────

const RULES = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const { matrixConstraints } = RULES;

// ── AGP 7 specific constants ──────────────────────────────────────────────────

const AGP7_KOTLIN_BUCKETS = ["1.7", "1.8", "1.9"]; // minor buckets to test
const AGP7_VERSIONS_PER_BUCKET = 2; // latest N per bucket
const AGP7_KSP_PER_KOTLIN = 2; // latest N KSP per Kotlin version

// AGP 7 is legacy — tighten forward window to 6 months.
// Real developers on AGP 7 are conservative and won't pair it with
// a BOM released a year later. Main pipeline stays at 12 months.
const AGP7_FORWARD_MONTHS_OVERRIDE = 6;

// ── Helpers ───────────────────────────────────────────────────────────────────

function semverCompare(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getMajor(version) {
  return version.split(".")[0];
}

function getMajorMinor(version) {
  const parts = version.split(".");
  return `${parts[0]}.${parts[1]}`;
}

function meetsMinimum(version, minimum) {
  return semverCompare(version, minimum) >= 0;
}

function meetsMaximum(version, maximum) {
  return semverCompare(version, maximum) <= 0;
}

function getLatestN(versions, n) {
  return [...versions].sort((a, b) => semverCompare(b, a)).slice(0, n);
}

function getReleasedAt(versionMap, version) {
  return versionMap[version]?.releasedAt
    ? new Date(versionMap[version].releasedAt)
    : null;
}

function isInKotlinWindow(
  libReleasedAt,
  kotlinReleasedAt,
  lookbackMonths,
  forwardMonths,
) {
  if (!libReleasedAt || !kotlinReleasedAt) return true;
  const libDate = new Date(libReleasedAt);
  const kotlinDate = new Date(kotlinReleasedAt);
  const lower = new Date(kotlinDate);
  lower.setMonth(lower.getMonth() - lookbackMonths);
  const upper = new Date(kotlinDate);
  upper.setMonth(upper.getMonth() + forwardMonths);
  return libDate >= lower && libDate <= upper;
}

function isAlreadyVerified(combo, compatData) {
  return compatData.combinations.some(
    (c) =>
      c.agp === combo.agp &&
      c.ksp === combo.ksp &&
      c.hilt === combo.hilt &&
      c.kotlin === combo.kotlin &&
      c.gradle === combo.gradle &&
      c.composeBom === combo.composeBom &&
      c.status === "verified",
  );
}

// Extract Kotlin version prefix from old KSP format: "1.9.25-1.0.20" → "1.9.25"
function kspToKotlinVersion(kspVersion) {
  const parts = kspVersion.split("-");
  return parts[0]; // "1.9.25"
}

// ── Candidate Generator ───────────────────────────────────────────────────────

function generateCandidates(registry, compatData) {
  const candidates = [];
  const { lookbackMonths } = matrixConstraints.libraryTimeWindow;
  const forwardMonths = AGP7_FORWARD_MONTHS_OVERRIDE;

  const minGradle = matrixConstraints.agpGradleMinimum["7"];
  const maxGradle = matrixConstraints.agpGradleMaximum["7"];
  const minKotlin = matrixConstraints.agpKotlinMinimum["7"];
  const maxKotlin = matrixConstraints.agpKotlinMaximum["7"];

  // AGP 7.x versions — latest 2
  const agpVersions = getLatestN(
    Object.keys(registry.agp || {}).filter((v) => getMajor(v) === "7"),
    matrixConstraints.maxVersionsPerComponent.agpPerMajor,
  );

  // Gradle: filtered to AGP 7 era bounds
  const gradleVersions = getLatestN(
    Object.keys(registry.gradle || {}).filter(
      (v) => meetsMinimum(v, minGradle) && meetsMaximum(v, maxGradle),
    ),
    matrixConstraints.maxVersionsPerComponent.gradle,
  );

  // Kotlin 1.x: latest N per minor bucket (1.7, 1.8, 1.9)
  const kotlinVersions = [];
  for (const bucket of AGP7_KOTLIN_BUCKETS) {
    const bucketed = getLatestN(
      Object.keys(registry.kotlin || {}).filter(
        (v) =>
          getMajorMinor(v) === bucket &&
          meetsMinimum(v, minKotlin) &&
          meetsMaximum(v, maxKotlin),
      ),
      AGP7_VERSIONS_PER_BUCKET,
    );
    kotlinVersions.push(...bucketed);
  }

  // All KSP 1.x versions (old prefixed format)
  const allKsp1Versions = Object.keys(registry.ksp || {}).filter(
    (v) => v.includes("-") && v.startsWith("1."),
  );

  // All Hilt and Compose BOM for date-window filtering
  const allHiltVersions = Object.keys(registry.hilt || {}).sort((a, b) =>
    semverCompare(b, a),
  );
  const allComposeBomVersions = Object.keys(registry.composeBom || {}).sort(
    (a, b) => semverCompare(b, a),
  );

  console.log("\n📋 AGP 7 version pools:");
  console.log(`  AGP 7.x:     ${agpVersions.join(", ")}`);
  console.log(`  Kotlin 1.x:  ${kotlinVersions.join(", ")}`);
  console.log(`  Gradle:      ${gradleVersions.join(", ")}`);
  console.log(`  KSP 1.x:     ${allKsp1Versions.slice(-4).join(", ")} ...`);

  let prunedByVerified = 0;
  let prunedNoKsp = 0;

  // Outer loop: Kotlin (master clock)
  for (const kotlin of kotlinVersions) {
    const kotlinReleasedAt = getReleasedAt(registry.kotlin, kotlin);

    // KSP: match by Kotlin version prefix in old format (e.g. "1.9.25-x.x.x")
    const kspVersions = getLatestN(
      allKsp1Versions.filter((v) => kspToKotlinVersion(v) === kotlin),
      AGP7_KSP_PER_KOTLIN,
    );

    if (kspVersions.length === 0) {
      console.log(`  ⚠️  No KSP for Kotlin ${kotlin} — skipping`);
      prunedNoKsp++;
      continue;
    }

    // Hilt: Kotlin date window
    const hiltVersions = getLatestN(
      allHiltVersions.filter((v) =>
        isInKotlinWindow(
          registry.hilt[v]?.releasedAt,
          kotlinReleasedAt,
          lookbackMonths,
          forwardMonths,
        ),
      ),
      matrixConstraints.maxVersionsPerComponent.hilt,
    );

    // Compose BOM: Kotlin date window
    const composeBomVersions = getLatestN(
      allComposeBomVersions.filter((v) =>
        isInKotlinWindow(
          registry.composeBom[v]?.releasedAt,
          kotlinReleasedAt,
          lookbackMonths,
          forwardMonths,
        ),
      ),
      matrixConstraints.maxVersionsPerComponent.composeBom,
    );

    for (const agp of agpVersions) {
      for (const gradle of gradleVersions) {
        for (const ksp of kspVersions) {
          for (const hilt of hiltVersions) {
            for (const composeBom of composeBomVersions) {
              const combo = { agp, kotlin, ksp, hilt, gradle, composeBom };

              if (isAlreadyVerified(combo, compatData)) {
                prunedByVerified++;
                continue;
              }

              candidates.push(combo);
            }
          }
        }
      }
    }
  }

  console.log(`\n📊 Pruning summary:`);
  console.log(`  Pruned - no KSP match:      ${prunedNoKsp}`);
  console.log(`  Pruned - already verified:  ${prunedByVerified}`);

  return candidates;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log("🧠 Generating AGP 7 historical candidates (one-time batch)...");
  console.log(`📖 Rules from ${RULES_PATH}`);
  console.log(
    `⏱️  Library window: -${matrixConstraints.libraryTimeWindow.lookbackMonths}mo / +${AGP7_FORWARD_MONTHS_OVERRIDE}mo from Kotlin release (AGP 7 override)\n`,
  );

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  const compatData = fs.existsSync(COMPAT_PATH)
    ? JSON.parse(fs.readFileSync(COMPAT_PATH, "utf8"))
    : { combinations: [] };

  const candidates = generateCandidates(registry, compatData);

  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates, null, 2));

  console.log(
    `\n✅ ${candidates.length} AGP 7 candidates written to combos-to-test-agp7.json`,
  );
  console.log("\n📋 Candidates:");
  candidates.forEach((c, i) => {
    console.log(
      `  ${i + 1}. AGP ${c.agp} | Kotlin ${c.kotlin} | KSP ${c.ksp} | Hilt ${c.hilt} | Gradle ${c.gradle} | BOM ${c.composeBom}`,
    );
  });
}

main();
