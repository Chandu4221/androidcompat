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

function getLatestNPerMinor(versionMap, majors, nPerMinor) {
  const result = [];
  for (const major of majors) {
    const majorVersions = Object.keys(versionMap).filter((v) => getMajor(v) === major);
    const byMinor = {};
    for (const v of majorVersions) {
      const minor = getMajorMinor(v);
      if (!byMinor[minor]) byMinor[minor] = [];
      byMinor[minor].push(v);
    }
    const sortedMinors = Object.keys(byMinor).sort((a, b) => semverCompare(b, a));
    for (const minor of sortedMinors) {
      const versions = byMinor[minor].sort((a, b) => semverCompare(b, a)).slice(0, nPerMinor);
      result.push(...versions);
    }
  }
  return result;
}

function getReleasedAt(versionMap, version) {
  const vData = versionMap[version];
  if (!vData) return null;
  const dateStr = vData.releasedAt || vData.detectedAt;
  return dateStr ? new Date(dateStr) : null;
}

function isInWindow(
  targetDate,
  anchorDate,
  lookbackMonths,
  forwardMonths,
) {
  if (!targetDate || !anchorDate) return false;
  const tDate = new Date(targetDate);
  const aDate = new Date(anchorDate);
  const lower = new Date(aDate);
  lower.setMonth(lower.getMonth() - lookbackMonths);
  const upper = new Date(aDate);
  upper.setMonth(upper.getMonth() + forwardMonths);
  return tDate >= lower && tDate <= upper;
}

// ── Candidate Generator ───────────────────────────────────────────────────────

function generateCandidates(registry, compatData) {
  const candidates = [];
  const { lookbackMonths, forwardMonths } = matrixConstraints.libraryTimeWindow;
  const { maxVersionsPerComponent } = matrixConstraints;

  const verifiedKeys = new Set(
    compatData.combinations
      .filter((c) => c.status === "verified")
      .map((c) => `${c.agp}-${c.kotlin}-${c.ksp}-${c.hilt}-${c.gradle}-${c.composeBom}`)
  );

  // ── Layer 1: Toolchain pools ──────────────────────────────────────────────

  const agpVersions = getLatestNPerMinor(
    registry.agp || {},
    matrixConstraints.agpMajorVersions,
    1 // latest 1 per minor
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

    // Hilt: filter by Kotlin date window (AGP-Hilt boundary applied later, per-AGP, since
    // the same Kotlin/Hilt pairing can be valid for AGP 9 but invalid for AGP 8)
    const hiltVersionsByDate = allHiltVersions.filter((v) =>
      isInWindow(
        getReleasedAt(registry.hilt, v),
        kotlinReleasedAt,
        lookbackMonths,
        forwardMonths,
      ),
    );

    // Compose BOM: filter by Kotlin date window
    const composeBomVersions = getLatestN(
      allComposeBomVersions.filter((v) =>
        isInWindow(
          getReleasedAt(registry.composeBom, v),
          kotlinReleasedAt,
          lookbackMonths,
          forwardMonths,
        ),
      ),
      maxVersionsPerComponent.composeBom,
    );

    for (const agp of agpVersions) {
      const agpReleasedAt = getReleasedAt(registry.agp, agp);

      // AGP date filter: check if AGP was released within window of Kotlin
      // Using same window for now.
      if (!isInWindow(agpReleasedAt, kotlinReleasedAt, lookbackMonths, forwardMonths)) {
        prunedByConstraint++;
        continue;
      }
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

      // Gradle: filtered by AGP min/max bounds and release date relative to AGP
      const gradleVersions = getLatestN(
        allGradleVersions.filter(
          (v) => 
            meetsMinimum(v, minGradle) && 
            meetsMaximum(v, maxGradle) &&
            isInWindow(
              getReleasedAt(registry.gradle, v),
              agpReleasedAt,
              lookbackMonths,
              forwardMonths
            )
        ),
        maxVersionsPerComponent.gradle,
      );

      if (gradleVersions.length === 0) {
        console.log(
          `  ⚠️  No Gradle for AGP ${agp} [${minGradle}, ${maxGradle}] — skipping`,
        );
        continue;
      }

      // Hilt 2.58 is the last version supporting AGP 8.x; 2.59+ requires AGP 9.0+.
      // Apply this hard cutover per-AGP before picking the latest N Hilt versions.
      const hiltBoundary = matrixConstraints.hiltAgpCompatibility;
      const hiltVersionsForThisAgp = hiltVersionsByDate.filter((v) => {
        if (agpMajor === "8")
          return !meetsMinimum(v, hiltBoundary.minHiltForAgp9);
        if (agpMajor === "9")
          return meetsMinimum(v, hiltBoundary.minHiltForAgp9);
        return true;
      });
      const hiltVersions = getLatestN(
        hiltVersionsForThisAgp,
        maxVersionsPerComponent.hilt,
      );

      if (hiltVersions.length === 0) {
        console.log(
          `  ⚠️  No compatible Hilt for AGP ${agp} (Kotlin ${kotlin}) — skipping`,
        );
        continue;
      }

      for (const gradle of gradleVersions) {
        for (const ksp of kspVersions) {
          for (const hilt of hiltVersions) {
            for (const composeBom of composeBomVersions) {
              const combo = { agp, kotlin, ksp, hilt, gradle, composeBom };

              const comboKey = `${combo.agp}-${combo.kotlin}-${combo.ksp}-${combo.hilt}-${combo.gradle}-${combo.composeBom}`;
              if (verifiedKeys.has(comboKey)) {
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
