// docs/libs-picker/lookup.js
// Core 3-state lookup engine, powered by the public compat-graph.json.
// Step 3 adds query-time confidence scoring for UNVERIFIED combos.

export function buildIndexes({ compat, graph }) {
  // 1. compatIndex: "agp|gradle|kotlin|ksp|hilt|..." -> compat entry
  const compatIndex = new Map();
  for (const entry of compat.results || []) {
    const libs = {};
    for (const lib of entry.libraries || []) {
      libs[lib.name] = lib.version;
    }
    const key = makeKey(entry.coreToolchain, libs);
    compatIndex.set(key, entry);
  }

  // 2. Graph indexes: adjacency + rule grouping
  const byFrom = {};
  const rulesByRef = {};
  for (const edge of graph.edges || []) {
    (byFrom[edge.from] ??= []).push(edge);
    if (edge.sourceType && edge.sourceType.startsWith("rules_json_type_")) {
      (rulesByRef[edge.sourceRef] ??= []).push(edge);
    }
  }

  // 3. Verified-node index for confidence scoring (Step 3).
  //    A node counts as "verified" ONLY if it appears in a verified_compatible
  //    edge sourced from compat.json — i.e. it was actually CI-tested. Most
  //    graph nodes are just "known to exist" (rule-derived) and are NOT verified.
  const verifiedNodeIds = new Set();
  for (const edge of graph.edges || []) {
    if (
      edge.relation === "verified_compatible" &&
      edge.sourceType === "compat_json"
    ) {
      verifiedNodeIds.add(edge.from);
      verifiedNodeIds.add(edge.to);
    }
  }
  const verifiedVersionsByType = {};
  for (const node of Object.values(graph.nodes)) {
    if (verifiedNodeIds.has(node.id)) {
      (verifiedVersionsByType[node.type] ??= []).push(node.version);
    }
  }

  return { compatIndex, byFrom, rulesByRef, verifiedVersionsByType };
}

export function lookup(input, indexes) {
  const results = [];
  results.push({ axis: "core", ...evaluateCore(input.core, indexes) });
  for (const [libName, libVersion] of Object.entries(input.libs || {})) {
    if (!libVersion) continue;
    results.push({
      axis: libName,
      ...evaluateLibrary(libName, libVersion, input.core, indexes),
    });
  }
  return results;
}

function makeKey(core, libs = {}) {
  const parts = [
    core.agp || "",
    core.gradle || "",
    core.kotlin || "",
    core.ksp || "",
  ];
  for (const libName of ["hilt", "room", "compose", "navigation"]) {
    parts.push(libs[libName] || "");
  }
  return parts.join("|");
}

function evaluateCore(core, indexes) {
  const { compatIndex, rulesByRef } = indexes;

  // 1. Exact combo match
  const exact = compatIndex.get(makeKey(core, {}));
  if (exact) {
    return {
      status: exact.status === "verified" ? "VERIFIED" : "KNOWN_ISSUE",
      ruleName:
        exact.status === "verified"
          ? null
          : exact.failureSignature || "build_failure",
      ruleNote: exact.errorMessage || null,
      ruleSource: exact.workflowUrl || null,
    };
  }

  // 2. Core rule checks
  const coreRuleViolation = checkCoreRules(core, rulesByRef);
  if (coreRuleViolation) return coreRuleViolation;

  // 3. No data -> confidence-scored UNVERIFIED (Step 3)
  return {
    status: "UNVERIFIED",
    ruleName: null,
    ruleNote: null,
    ruleSource: null,
    ...scoreCoreConfidence(core, indexes),
  };
}

function checkCoreRules(core, rulesByRef) {
  // agp.requiredGradle (exact pin per AGP version)
  for (const edge of rulesByRef["agp.requiredGradle"] || []) {
    const edgeAgp = edge.from.split(":")[1];
    const reqGradle = edge.to.split(":")[1];
    if (edgeAgp === core.agp && core.gradle !== reqGradle) {
      return {
        status: "KNOWN_ISSUE",
        ruleName: "agp.requiredGradle",
        ruleNote: `AGP ${core.agp} is documented to pair with Gradle ${reqGradle}. You selected Gradle ${core.gradle}.`,
        ruleSource: edge.source || null,
      };
    }
  }

  // agp.builtInKotlinMinimum (floor, AGP9+)
  for (const edge of rulesByRef["agp.builtInKotlinMinimum"] || []) {
    const edgeAgp = edge.from.split(":")[1];
    const minKotlin = edge.to.split(":")[1];
    if (edgeAgp === core.agp && compareVersions(core.kotlin, minKotlin) < 0) {
      return {
        status: "KNOWN_ISSUE",
        ruleName: "agp.builtInKotlinMinimum",
        ruleNote:
          edge.note ||
          `AGP ${core.agp} requires Kotlin ${minKotlin} or higher.`,
        ruleSource: edge.source || null,
      };
    }
  }

  // agp.requiredJdk and agp.compileSdkFloors are skipped: JDK and compileSdk
  // are not collected by the core picker UI yet.
  return null;
}

function evaluateLibrary(libName, libVersion, core, indexes) {
  const { compatIndex, rulesByRef } = indexes;

  // 1. Exact combo match
  const exact = compatIndex.get(makeKey(core, { [libName]: libVersion }));
  if (exact) {
    return {
      status: exact.status === "verified" ? "VERIFIED" : "KNOWN_ISSUE",
      ruleName:
        exact.status === "verified"
          ? null
          : exact.failureSignature || "build_failure",
      ruleNote: exact.errorMessage || null,
      ruleSource: exact.workflowUrl || null,
    };
  }

  // 2. Rule violation check
  const ruleViolation = checkLibraryRules(
    libName,
    libVersion,
    core,
    rulesByRef,
  );
  if (ruleViolation) return ruleViolation;

  // 3. No data -> confidence-scored UNVERIFIED (Step 3)
  const scored = scoreAxisConfidence(libName, libVersion, indexes);
  return {
    status: "UNVERIFIED",
    ruleName: null,
    ruleNote: null,
    ruleSource: null,
    confidence: scored.confidence,
    nearestVerified: scored.nearest,
    nearestDistance: scored.distance,
  };
}

function checkLibraryRules(libName, libVersion, core, rulesByRef) {
  if (libName === "hilt") {
    for (const edge of rulesByRef["hilt.hiltGradleFloors"] || []) {
      const edgeHilt = edge.from.split(":")[1];
      const reqGradle = edge.to.split(":")[1];
      if (
        edgeHilt === libVersion &&
        compareVersions(core.gradle, reqGradle) < 0
      ) {
        return {
          status: "KNOWN_ISSUE",
          ruleName: "hilt.hiltGradleFloors",
          ruleNote: edge.note,
          ruleSource: edge.source || null,
        };
      }
    }
    for (const edge of rulesByRef["hilt.requiredAgp"] || []) {
      const edgeHilt = edge.from.split(":")[1];
      const reqAgp = edge.to.split(":")[1];
      if (edgeHilt === libVersion && compareVersions(core.agp, reqAgp) < 0) {
        return {
          status: "KNOWN_ISSUE",
          ruleName: "hilt.requiredAgp",
          ruleNote: edge.note,
          ruleSource: edge.source || null,
        };
      }
    }
  }

  if (libName === "room") {
    for (const edge of rulesByRef["room.gradlePluginRequiredAgp"] || []) {
      const edgeRoom = edge.from.split(":")[1];
      const reqAgp = edge.to.split(":")[1];
      if (edgeRoom === libVersion && compareVersions(core.agp, reqAgp) < 0) {
        return {
          status: "KNOWN_ISSUE",
          ruleName: "room.gradlePluginRequiredAgp",
          ruleNote: edge.note,
          ruleSource: edge.source || null,
        };
      }
    }
    for (const edge of rulesByRef["room.minKotlin"] || []) {
      const edgeRoom = edge.from.split(":")[1];
      const reqKotlin = edge.to.split(":")[1];
      if (
        edgeRoom === libVersion &&
        compareVersions(core.kotlin, reqKotlin) < 0
      ) {
        return {
          status: "KNOWN_ISSUE",
          ruleName: "room.minKotlin",
          ruleNote: edge.note,
          ruleSource: edge.source || null,
        };
      }
    }
  }

  if (libName === "navigation") {
    for (const edge of rulesByRef["navigation.safeArgsRequiredAgp"] || []) {
      const edgeNav = edge.from.split(":")[1];
      const reqAgp = edge.to.split(":")[1];
      if (edgeNav === libVersion && compareVersions(core.agp, reqAgp) < 0) {
        return {
          status: "KNOWN_ISSUE",
          ruleName: "navigation.safeArgsRequiredAgp",
          ruleNote: edge.note,
          ruleSource: edge.source || null,
        };
      }
    }
  }

  if (libName === "compose") {
    const composePins = [
      ...(rulesByRef["compose.compilerKotlinExactPin_legacy"] || []),
      ...(rulesByRef["compose.compilerKotlinExactPin_modern"] || []),
    ];
    for (const edge of composePins) {
      const edgeCompose = edge.from.split(":")[1];
      const pinnedKotlin = edge.to.split(":")[1];
      if (edgeCompose === libVersion && core.kotlin !== pinnedKotlin) {
        return {
          status: "KNOWN_ISSUE",
          ruleName: "compose.compilerKotlinExactPin",
          ruleNote:
            edge.note ||
            `Compose ${libVersion} requires exactly Kotlin ${pinnedKotlin}.`,
          ruleSource: edge.source || null,
        };
      }
    }
  }

  return null;
}

// ---------- Confidence scoring (Step 3) ----------
// Query-time proximity heuristic for UNVERIFIED combos. Outputs HIGH/MEDIUM/LOW
// only — never a percentage. This is "nearness to something CI-tested," not a
// probability of success.

// Port of registry.go's isKspComposite: composite KSP versions contain a
// hyphen ("<kotlin>-<ksp>", pre-2.3.0); semver ones never do.
function isKspComposite(v) {
  return String(v).includes("-");
}

// Level of the first differing segment: "same" | "patch" | "minor" | "major".
function segmentDistance(a, b) {
  const pa = String(a)
    .split(".")
    .map((s) => parseInt(s, 10) || 0);
  const pb = String(b)
    .split(".")
    .map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) {
      if (i === 0) return "major";
      if (i === 1) return "minor";
      return "patch";
    }
  }
  return "same";
}

// KSP distance — NEVER compares across the composite/semver format boundary.
function kspDistance(picked, nearest) {
  if (isKspComposite(picked) !== isKspComposite(nearest)) {
    return "boundary"; // format change — automatically LOW, no numeric comparison
  }
  if (isKspComposite(picked)) {
    const [pKotlin, pKsp] = String(picked).split("-");
    const [nKotlin, nKsp] = String(nearest).split("-");
    if (pKotlin !== nKotlin) return segmentDistance(pKotlin, nKotlin);
    return segmentDistance(pKsp, nKsp);
  }
  return segmentDistance(picked, nearest);
}

function axisDistance(axis, a, b) {
  return axis === "ksp" ? kspDistance(a, b) : segmentDistance(a, b);
}

const DISTANCE_RANK = { same: 0, patch: 1, minor: 2, major: 3, boundary: 4 };
const CONFIDENCE_RANK = { HIGH: 2, MEDIUM: 1, LOW: 0 };

// Distance -> confidence, weighted per axis.
// AGP/Gradle/Kotlin are "strict": minor jumps change floors/ceilings and
// language levels, so only a patch-level neighbor counts as HIGH.
// Library axes (hilt/room/navigation/compose) and same-format KSP use the
// standard semver weighting (patch=HIGH, minor=MEDIUM, major=LOW).
function distanceToConfidence(axis, distance) {
  if (distance === "same") return "HIGH";
  if (distance === "boundary") return "LOW";
  const strict = axis === "agp" || axis === "gradle" || axis === "kotlin";
  if (strict) return distance === "patch" ? "HIGH" : "LOW";
  if (distance === "patch") return "HIGH";
  if (distance === "minor") return "MEDIUM";
  return "LOW";
}

// Nearest CI-verified version of `axis` to `pickedVersion`, with confidence.
function scoreAxisConfidence(axis, pickedVersion, indexes) {
  const candidates = indexes.verifiedVersionsByType[axis] || [];
  if (candidates.length === 0) {
    return { confidence: "LOW", nearest: null, distance: null };
  }
  let best = null;
  for (const cand of candidates) {
    const distance = axisDistance(axis, pickedVersion, cand);
    const rank = DISTANCE_RANK[distance];
    if (!best || rank < best.rank) {
      best = { distance, nearest: cand, rank };
    }
  }
  return {
    confidence: distanceToConfidence(axis, best.distance),
    nearest: best.nearest,
    distance: best.distance,
  };
}

// Overall combo confidence = LOWEST per-axis confidence (one bad axis tanks it).
function scoreCoreConfidence(core, indexes) {
  const perAxis = {};
  let weakest = null;
  for (const axis of ["agp", "gradle", "kotlin", "ksp"]) {
    const ver = core[axis];
    if (!ver) continue;
    const scored = scoreAxisConfidence(axis, ver, indexes);
    perAxis[axis] = scored;
    if (
      !weakest ||
      CONFIDENCE_RANK[scored.confidence] <
        CONFIDENCE_RANK[weakest.scored.confidence]
    ) {
      weakest = { axis, scored };
    }
  }
  if (!weakest) return { confidence: "LOW", perAxis };
  return {
    confidence: weakest.scored.confidence,
    weakestAxis: weakest.axis,
    nearestVerified: weakest.scored.nearest,
    nearestDistance: weakest.scored.distance,
    perAxis,
  };
}

// Step 5 — transitive query: given a selected library node, return the
// core-toolchain constraints it imposes, by walking its outgoing "requires"
// edges. kind="pin" for exact pins (compose↔kotlin), "floor" otherwise.
export function constraintsForNode(nodeId, indexes) {
  const edges = indexes.byFrom[nodeId] || [];
  const out = [];
  for (const e of edges) {
    if (e.relation !== "requires") continue;
    const [axis, version] = e.to.split(":");
    if (!["agp", "gradle", "kotlin", "ksp"].includes(axis)) continue; // only picker-controlled axes
    const kind = (e.sourceRef || "").includes("ExactPin") ? "pin" : "floor";
    out.push({
      axis,
      version,
      kind,
      note: e.note || null,
      sourceRef: e.sourceRef,
    });
  }
  return out;
}

// Left as-is per project decision (naive split; safe for current rule checks).
// Confidence scoring uses its own format-aware segmentDistance/kspDistance above.
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
