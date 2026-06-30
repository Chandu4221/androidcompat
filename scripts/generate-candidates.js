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

// ── Candidate Generator ───────────────────────────────────────────────────────

function generateCandidates(registry, compatData) {
  const candidates = [];
  const { lookbackMonths, forwardMonths } = matrixConstraints.libraryTimeWindow;
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

  const kotlinVersions = getLatestN(
    Object.keys(registry.kotlin || {}).filter((v) =>
      matrixConstraints.kotlinMajorVersions.includes(getMajor(v)),
    ),
    maxVersionsPerComponent.kotlin,
  );

  // ── Layer 2: Library pools ────────────────────────────────────────────────

  const allKspVersions = Object.keys(registry.ksp || {}).filter((v) =>
    meetsMinimum(v, matrixConstraints.kspIndependentFrom.version),
  );

  const allHiltVersions = Object.keys(registry.hilt || {}).sort((a, b) =>
    semverCompare(b, a),
  );

  const allComposeBomVersions = Object.keys(registry.composeBom || {}).sort(
    (a, b) => semverCompare(b, a),
  );

  console.log("\n📋 Version pools:");
  console.log(`  AGP:         ${agpVersions.join(", ")}`);
  console.log(`  Kotlin:      ${kotlinVersions.join(", ")}`);
  console.log(`  Gradle pool: ${allGradleVersions.slice(0, 4).join(", ")} ...`);
  console.log(`  KSP pool:    ${allKspVersions.slice(0, 4).join(", ")} ...`);
  console.log(`  Hilt pool:   ${allHiltVersions.slice(0, 4).join(", ")} ...`);
  console.log(
    `  BOM pool:    ${allComposeBomVersions.slice(0, 3).join(", ")} ...`,
  );

  let prunedByConstraint = 0;
  let prunedByVerified = 0;

  // Outer loop: Kotlin (master clock)
  for (const kotlin of kotlinVersions) {
    const kotlinReleasedAt = getReleasedAt(registry.kotlin, kotlin);
    const kotlinMajorMinor = getMajorMinor(kotlin);

    // KSP: 1:1 major.minor match with Kotlin
    const kspVersions = getLatestN(
      allKspVersions.filter((v) => getMajorMinor(v) === kotlinMajorMinor),
      maxVersionsPerComponent.ksp,
    );

    if (kspVersions.length === 0) {
      console.log(
        `  ⚠️  No KSP for Kotlin ${kotlin} (${kotlinMajorMinor}) — skipping`,
      );
      continue;
    }

    // Hilt: filter by Kotlin date window
    const hiltVersions = getLatestN(
      allHiltVersions.filter((v) =>
        isInKotlinWindow(
          registry.hilt[v]?.releasedAt,
          kotlinReleasedAt,
          lookbackMonths,
          forwardMonths,
        ),
      ),
      maxVersionsPerComponent.hilt,
    );

    // Compose BOM: filter by Kotlin date window
    const composeBomVersions = getLatestN(
      allComposeBomVersions.filter((v) =>
        isInKotlinWindow(
          registry.composeBom[v]?.releasedAt,
          kotlinReleasedAt,
          lookbackMonths,
          forwardMonths,
        ),
      ),
      maxVersionsPerComponent.composeBom,
    );

    for (const agp of agpVersions) {
      const agpMajor = getMajor(agp);
      const minKotlin = matrixConstraints.agpKotlinMinimum[agpMajor] || "1.9.0";
      const maxKotlin =
        matrixConstraints.agpKotlinMaximum[agpMajor] || "9.9.99";
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

      // Prune: Kotlin outside AGP bounds
      if (
        !meetsMinimum(kotlin, minKotlin) ||
        !meetsMaximum(kotlin, maxKotlin)
      ) {
        prunedByConstraint++;
        continue;
      }

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
  console.log(`  Pruned by AGP/Kotlin constraint: ${prunedByConstraint}`);
  console.log(`  Pruned by already verified:      ${prunedByVerified}`);

  return candidates;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log("🧠 Generating test candidates (Two-Layer Cake)...");
  console.log(`📖 Rules from ${RULES_PATH}`);
  console.log(
    `⏱️  Library window: -${matrixConstraints.libraryTimeWindow.lookbackMonths}mo / +${matrixConstraints.libraryTimeWindow.forwardMonths}mo from Kotlin release\n`,
  );

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
      `  ${i + 1}. AGP ${c.agp} | Kotlin ${c.kotlin} | KSP ${c.ksp} | Hilt ${c.hilt} | Gradle ${c.gradle} | BOM ${c.composeBom}`,
    );
  });
}

main();
