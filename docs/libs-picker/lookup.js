// docs/libs-picker/lookup.js
// Core 3-state lookup engine, powered by the public compat-graph.json

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

  // 2. Graph Index: Adjacency list + Rule grouping
  const byFrom = {};
  const rulesByRef = {};

  for (const edge of graph.edges || []) {
    (byFrom[edge.from] ??= []).push(edge);
    if (edge.sourceType && edge.sourceType.startsWith("rules_json_type_")) {
      (rulesByRef[edge.sourceRef] ??= []).push(edge);
    }
  }

  return { compatIndex, byFrom, rulesByRef };
}

export function lookup(input, indexes) {
  const { compatIndex, rulesByRef } = indexes;
  const results = [];

  // 1. Core toolchain check
  results.push({
    axis: "core",
    ...evaluateCore(input.core, compatIndex, rulesByRef),
  });

  // 2. Per-library check
  for (const [libName, libVersion] of Object.entries(input.libs || {})) {
    if (!libVersion) continue;
    results.push({
      axis: libName,
      ...evaluateLibrary(
        libName,
        libVersion,
        input.core,
        compatIndex,
        rulesByRef,
      ),
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

function evaluateCore(core, compatIndex, rulesByRef) {
  // 1. Exact combo match
  const key = makeKey(core, {});
  const exact = compatIndex.get(key);

  if (exact) {
    return {
      status: exact.status === "verified" ? "VERIFIED" : "KNOWN_ISSUE",
      ruleName:
        exact.status === "verified"
          ? null
          : exact.failureSignature || "build_failure",
      ruleNote: exact.errorMessage || null,
      ruleSource: exact.workflowUrl || null, // BUG 1 FIX: lowercase 'url'
    };
  }

  // 2. Core rule checks (AGP -> Gradle, Built-in Kotlin)
  const coreRuleViolation = checkCoreRules(core, rulesByRef);
  if (coreRuleViolation) return coreRuleViolation;

  // 3. No data
  return {
    status: "UNVERIFIED",
    ruleName: null,
    ruleNote: null,
    ruleSource: null,
  };
}

function checkCoreRules(core, rulesByRef) {
  // agp.requiredGradle (Exact Pin)
  const reqGradleEdges = rulesByRef["agp.requiredGradle"] || [];
  for (const edge of reqGradleEdges) {
    const edgeAgp = edge.from.split(":")[1];
    const reqGradle = edge.to.split(":")[1];
    if (edgeAgp === core.agp && core.gradle !== reqGradle) {
      return {
        status: "KNOWN_ISSUE",
        ruleName: "agp.requiredGradle",
        ruleNote: `AGP ${core.agp} requires exactly Gradle ${reqGradle}. You selected Gradle ${core.gradle}.`,
        ruleSource: edge.source || null,
      };
    }
  }

  // agp.builtInKotlinMinimum (Floor, AGP9+)
  const builtInKotlinEdges = rulesByRef["agp.builtInKotlinMinimum"] || [];
  for (const edge of builtInKotlinEdges) {
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

  // Note: agp.requiredJdk and agp.compileSdkFloors are skipped because
  // JDK and compileSdk are not currently collected in the core UI picker.

  return null;
}

function evaluateLibrary(libName, libVersion, core, compatIndex, rulesByRef) {
  // 1. Exact combo match
  const key = makeKey(core, { [libName]: libVersion });
  const exact = compatIndex.get(key);

  if (exact) {
    return {
      status: exact.status === "verified" ? "VERIFIED" : "KNOWN_ISSUE",
      ruleName:
        exact.status === "verified"
          ? null
          : exact.failureSignature || "build_failure",
      ruleNote: exact.errorMessage || null,
      ruleSource: exact.workflowUrl || null, // BUG 1 FIX: lowercase 'url'
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

  // 3. No data
  return {
    status: "UNVERIFIED",
    ruleName: null,
    ruleNote: null,
    ruleSource: null,
  };
}

function checkLibraryRules(libName, libVersion, core, rulesByRef) {
  if (libName === "hilt") {
    const hiltGradleEdges = rulesByRef["hilt.hiltGradleFloors"] || [];
    for (const edge of hiltGradleEdges) {
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

    const hiltAgpEdges = rulesByRef["hilt.requiredAgp"] || [];
    for (const edge of hiltAgpEdges) {
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
    const roomAgpEdges = rulesByRef["room.gradlePluginRequiredAgp"] || [];
    for (const edge of roomAgpEdges) {
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

    const roomKotlinEdges = rulesByRef["room.minKotlin"] || [];
    for (const edge of roomKotlinEdges) {
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
    const navAgpEdges = rulesByRef["navigation.safeArgsRequiredAgp"] || [];
    for (const edge of navAgpEdges) {
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

// Left as-is per instructions (naive split, safe for current rule checks)
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
