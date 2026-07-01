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

function getLatestNPerMajor(versionMap, majors, nPerMajor) {
  const result = [];
  for (const major of majors) {
    const filtered = Object.keys(versionMap)
      .filter((v) => getMajor(v) === major)
      .sort((a, b) => semverCompare(b, a))
      .slice(0, nPerMajor);
    result.push(...filtered);
  }
  return result;
}

function isAlreadyVerified(combo, compatData) {
  return compatData.combinations.some(
    (c) =>
      c.agp === combo.agp &&
      c.gradle === combo.gradle &&
      c.status === "verified",
  );
}

// ── Candidate Generator ───────────────────────────────────────────────────────

function generateCandidates(registry, compatData) {
  const candidates = [];
  const { maxVersionsPerComponent } = matrixConstraints;

  // ── Layer 1: Toolchain pools ──────────────────────────────────────────────

  const agpVersions = getLatestNPerMajor(
    registry.agp || {},
    matrixConstraints.agpMajorVersions,
    maxVersionsPerComponent.agpPerMajor,
  );

  const allGradleVersions = Object.keys(registry.gradle || {}).sort((a, b) =>
    semverCompare(b, a),
  );

  console.log("\n📋 Version pools:");
  console.log(`  AGP:         ${agpVersions.join(", ")}`);
  console.log(`  Gradle pool: ${allGradleVersions.slice(0, 4).join(", ")} ...`);

  let prunedByVerified = 0;

  for (const agp of agpVersions) {
    const agpMajor = getMajor(agp);
    
    // Check for a per-minor-version override first (e.g. AGP 8.13 requires
    // Gradle 8.13 exactly, stricter than the AGP 8.x default of 8.6.0)
    const agpMajorMinor = getMajorMinor(agp);
    const overrides = matrixConstraints.agpGradleMinimumOverrides || {};
    const minGradle =
      overrides[agp] ||
      overrides[agpMajorMinor] ||
      matrixConstraints.agpGradleMinimum[agpMajor] ||
      "8.6.0";
    const maxGradle = matrixConstraints.agpGradleMaximum[agpMajor] || "9.9.9";

    // Gradle: filtered by AGP min/max bounds
    const gradleVersions = getLatestN(
      allGradleVersions.filter(
        (v) => meetsMinimum(v, minGradle) && meetsMaximum(v, maxGradle),
      ),
      maxVersionsPerComponent.gradle,
    );

    if (gradleVersions.length === 0) {
      console.log(
        `  ⚠️  No Gradle for AGP ${agp} [${minGradle}, ${maxGradle}] — skipping`,
      );
      continue;
    }

    for (const gradle of gradleVersions) {
      const java_version =
        matrixConstraints.agpJdkRequirements[agp] ||
        matrixConstraints.agpJdkRequirements[agpMajorMinor] ||
        matrixConstraints.agpJdkRequirements[agpMajor] ||
        "17";

      const combo = { agp, gradle, java_version };

      if (isAlreadyVerified(combo, compatData)) {
        prunedByVerified++;
        continue;
      }

      candidates.push(combo);
    }
  }

  console.log(`\n📊 Pruning summary:`);
  console.log(`  Pruned by already verified:      ${prunedByVerified}`);

  return candidates;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log("🧠 Generating test candidates (AGP & Gradle Baseline)...");
  console.log(`📖 Rules from ${RULES_PATH}\n`);

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
      `  ${i + 1}. AGP ${c.agp} | Gradle ${c.gradle} | Java ${c.java_version}`,
    );
  });
}

main();
