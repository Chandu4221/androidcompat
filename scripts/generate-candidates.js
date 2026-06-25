require("dotenv").config();
const fs = require("fs");
const path = require("path");

const REGISTRY_PATH = path.join(__dirname, "../data/version-registry.json");
const COMPAT_PATH = path.join(__dirname, "../data/compat.json");
const CANDIDATES_PATH = path.join(__dirname, "../data/combos-to-test.json");

// ── Compatibility Rules ───────────────────────────────────────────────────────
// These are the known constraints that prune the search space.
// Update this when Google changes requirements.

const RULES = {
  // AGP 9.x requires Gradle 9.1+
  agpGradleMinimum: {
    9: "9.1.0",
    8: "8.6.0",
  },

  // AGP 9.x requires Kotlin 2.0+
  agpKotlinMinimum: {
    9: "2.0.0",
    8: "1.9.0",
  },

  // Only test AGP 8.x and 9.x — older is irrelevant
  agpMajorVersions: ["8", "9"],

  // Only test Kotlin 2.x
  kotlinMajorVersions: ["2"],

  // KSP versions before 2.3.0 used Kotlin prefix format
  // After 2.3.0 it's independent — always compatible with latest Kotlin
  kspIndependentFrom: "2.3.0",

  // Only test latest N versions per component to keep CI jobs manageable
  maxVersionsPerComponent: {
    agp: 2, // was 3
    ksp: 2, // was 3
    hilt: 2, // was 3
    kotlin: 2, // was 3
    gradle: 2, // was 3
    composeBom: 1, // was 2 — remove this dimension for now
  },
};

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

function getLatestN(versions, n) {
  return [...versions].sort((a, b) => semverCompare(b, a)).slice(0, n);
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

function meetsMinimum(version, minimum) {
  return semverCompare(version, minimum) >= 0;
}

// ── Candidate Generator ───────────────────────────────────────────────────────

function generateCandidates(registry, compatData) {
  const candidates = [];

  // Get stable versions per component filtered by rules
  const agpVersions = getLatestN(
    Object.keys(registry.agp || {}).filter((v) =>
      RULES.agpMajorVersions.includes(getMajor(v)),
    ),
    RULES.maxVersionsPerComponent.agp,
  );

  const kspVersions = getLatestN(
    Object.keys(registry.ksp || {}).filter((v) =>
      meetsMinimum(v, RULES.kspIndependentFrom),
    ),
    RULES.maxVersionsPerComponent.ksp,
  );

  const hiltVersions = getLatestN(
    Object.keys(registry.hilt || {}),
    RULES.maxVersionsPerComponent.hilt,
  );

  const kotlinVersions = getLatestN(
    Object.keys(registry.kotlin || {}).filter((v) =>
      RULES.kotlinMajorVersions.includes(getMajor(v)),
    ),
    RULES.maxVersionsPerComponent.kotlin,
  );

  const gradleVersions = getLatestN(
    Object.keys(registry.gradle || {}),
    RULES.maxVersionsPerComponent.gradle,
  );

  const composeBomVersions = getLatestN(
    Object.keys(registry.composeBom || {}),
    RULES.maxVersionsPerComponent.composeBom,
  );

  console.log("\n📋 Version pool after filtering:");
  console.log(`  AGP:         ${agpVersions.join(", ")}`);
  console.log(`  KSP:         ${kspVersions.join(", ")}`);
  console.log(`  Hilt:        ${hiltVersions.join(", ")}`);
  console.log(`  Kotlin:      ${kotlinVersions.join(", ")}`);
  console.log(`  Gradle:      ${gradleVersions.join(", ")}`);
  console.log(`  Compose BOM: ${composeBomVersions.join(", ")}`);

  // Generate combos — AGP drives the outer loop
  for (const agp of agpVersions) {
    const agpMajor = getMajor(agp);
    const minKotlin = RULES.agpKotlinMinimum[agpMajor] || "2.0.0";
    const minGradle = RULES.agpGradleMinimum[agpMajor] || "8.6.0";

    for (const kotlin of kotlinVersions) {
      // Skip if Kotlin doesn't meet AGP minimum
      if (!meetsMinimum(kotlin, minKotlin)) continue;

      for (const ksp of kspVersions) {
        for (const hilt of hiltVersions) {
          for (const gradle of gradleVersions) {
            // Skip if Gradle doesn't meet AGP minimum
            if (!meetsMinimum(gradle, minGradle)) continue;

            for (const composeBom of composeBomVersions) {
              const combo = { agp, kotlin, ksp, hilt, gradle, composeBom };

              // Skip already verified combos
              if (isAlreadyVerified(combo, compatData)) {
                console.log(
                  `  ⏭️  Skipping already verified: AGP ${agp} + KSP ${ksp} + Hilt ${hilt}`,
                );
                continue;
              }

              candidates.push(combo);
            }
          }
        }
      }
    }
  }

  return candidates;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log("🧠 Generating test candidates...");

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  // With this:
  const compatData = fs.existsSync(COMPAT_PATH)
    ? JSON.parse(fs.readFileSync(COMPAT_PATH, "utf8"))
    : { combinations: [] };

  const candidates = generateCandidates(registry, compatData);

  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates, null, 2));

  console.log(
    `\n✅ ${candidates.length} candidates written to combos-to-test.json`,
  );
  console.log("\n📋 Candidates:");
  candidates.forEach((c, i) => {
    console.log(
      `  ${i + 1}. AGP ${c.agp} | Kotlin ${c.kotlin} | KSP ${c.ksp} | Hilt ${c.hilt} | Gradle ${c.gradle}`,
    );
  });
}

main();
