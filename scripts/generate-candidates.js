require("dotenv").config();
const fs = require("fs");
const path = require("path");

const REGISTRY_PATH = path.join(__dirname, "../data/version-registry.json");
const COMPAT_PATH = path.join(__dirname, "../data/compat.json");
const CANDIDATES_PATH = path.join(__dirname, "../data/combos-to-test.json");
const RULES_PATH = path.join(__dirname, "../data/rules.json");

// ── Load Rules ────────────────────────────────────────────────────────────────

const RULES = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const { matrixConstraints } = RULES;

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

  const agpVersions = getLatestN(
    Object.keys(registry.agp || {}).filter((v) =>
      matrixConstraints.agpMajorVersions.includes(getMajor(v)),
    ),
    matrixConstraints.maxVersionsPerComponent.agp,
  );

  const kspVersions = getLatestN(
    Object.keys(registry.ksp || {}).filter((v) =>
      meetsMinimum(v, matrixConstraints.kspIndependentFrom.version),
    ),
    matrixConstraints.maxVersionsPerComponent.ksp,
  );

  const hiltVersions = getLatestN(
    Object.keys(registry.hilt || {}),
    matrixConstraints.maxVersionsPerComponent.hilt,
  );

  const kotlinVersions = getLatestN(
    Object.keys(registry.kotlin || {}).filter((v) =>
      matrixConstraints.kotlinMajorVersions.includes(getMajor(v)),
    ),
    matrixConstraints.maxVersionsPerComponent.kotlin,
  );

  const gradleVersions = getLatestN(
    Object.keys(registry.gradle || {}),
    matrixConstraints.maxVersionsPerComponent.gradle,
  );

  const composeBomVersions = getLatestN(
    Object.keys(registry.composeBom || {}),
    matrixConstraints.maxVersionsPerComponent.composeBom,
  );

  console.log("\n📋 Version pool after filtering:");
  console.log(`  AGP:         ${agpVersions.join(", ")}`);
  console.log(`  KSP:         ${kspVersions.join(", ")}`);
  console.log(`  Hilt:        ${hiltVersions.join(", ")}`);
  console.log(`  Kotlin:      ${kotlinVersions.join(", ")}`);
  console.log(`  Gradle:      ${gradleVersions.join(", ")}`);
  console.log(`  Compose BOM: ${composeBomVersions.join(", ")}`);

  for (const agp of agpVersions) {
    const agpMajor = getMajor(agp);
    const minKotlin = matrixConstraints.agpKotlinMinimum[agpMajor] || "2.0.0";
    const minGradle = matrixConstraints.agpGradleMinimum[agpMajor] || "8.6.0";

    for (const kotlin of kotlinVersions) {
      if (!meetsMinimum(kotlin, minKotlin)) continue;

      for (const ksp of kspVersions) {
        for (const hilt of hiltVersions) {
          for (const gradle of gradleVersions) {
            if (!meetsMinimum(gradle, minGradle)) continue;

            for (const composeBom of composeBomVersions) {
              const combo = { agp, kotlin, ksp, hilt, gradle, composeBom };

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
  console.log(`📖 Loaded rules from ${RULES_PATH}\n`);

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
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
