// docs/analyzer/axis-map.js
//
// Maps version-catalog picks (plugin-id / group:artifact) onto AndroidCompat's
// rule axes. This mapping MIRRORS the tracker's own coordinate logic — do not
// let it drift:
//
//   registry.go libraryCoordinate():
//     hilt       -> com.google.dagger:hilt-android-gradle-plugin
//     room       -> androidx.room:room-gradle-plugin
//     navigation -> androidx.navigation:navigation-safe-args-gradle-plugin
//     coreKtx    -> androidx.core:core-ktx
//
//   candidate.go getValidComposeVersions():
//     compose axis == kotlin version (Kotlin 2.0+); legacy compiler pins below 2.0.
//     => the compose axis is the COMPOSE COMPILER, not the Compose UI libraries.
//
// Lockstep assumption: hilt-*, room-*, navigation-* artifacts within a group
// release on one shared version — the same assumption the tracker makes.
// (Inherits known open item #1: the room coordinate stand-in is unverified
// against Maven; if that changes upstream, update this file in the same commit.)

import { compareVersions } from "../libs-picker/lookup.js";

export const CORE_AXES = ["agp", "gradle", "kotlin", "ksp"];
export const LIB_AXES = ["hilt", "room", "compose", "navigation"];

// Axes the tracker models but the picker engine does not evaluate
// (they depend on compileSdk/JDK, which a version catalog cannot express).
const OBSERVED_AXES = ["coreKtx"];

const PLUGIN_MAP = {
  "com.android.application": "agp",
  "com.android.library": "agp",
  "com.android.test": "agp",
  "com.android.dynamic-feature": "agp",
  "org.jetbrains.kotlin.android": "kotlin",
  "org.jetbrains.kotlin.jvm": "kotlin",
  "org.jetbrains.kotlin.multiplatform": "kotlin",
  "com.google.devtools.ksp": "ksp",
  "com.google.dagger.hilt.android": "hilt",
  // Kotlin 2.0+ Compose COMPILER plugin — version tracks Kotlin exactly,
  // so it maps to the compose axis (candidate.go getValidComposeVersions).
  "org.jetbrains.kotlin.plugin.compose": "compose",
};

const ARTIFACT_MAP = {
  "com.android.tools.build:gradle": "agp",
  "org.jetbrains.kotlin:kotlin-gradle-plugin": "kotlin",
  "com.google.devtools.ksp:symbol-processing-gradle-plugin": "ksp",
  "com.google.devtools.ksp:symbol-processing-api": "ksp",
  // hilt — plugin, runtime, and compiler release in lockstep (same 2.x version)
  "com.google.dagger:hilt-android-gradle-plugin": "hilt",
  "com.google.dagger:hilt-android": "hilt",
  "com.google.dagger:hilt-compiler": "hilt",
  // room — tracker's axis stand-in is room-gradle-plugin; artifacts are lockstep
  "androidx.room:room-gradle-plugin": "room",
  "androidx.room:room-runtime": "room",
  "androidx.room:room-ktx": "room",
  "androidx.room:room-compiler": "room",
  // navigation — lockstep
  "androidx.navigation:navigation-safe-args-gradle-plugin": "navigation",
  "androidx.navigation:navigation-fragment-ktx": "navigation",
  "androidx.navigation:navigation-ui-ktx": "navigation",
  "androidx.navigation:navigation-compose": "navigation",
  // coreKtx — tracked axis, but see OBSERVED_AXES above
  "androidx.core:core-ktx": "coreKtx",
};

// Entries that matter to a real project but are NOT graph axes. Reported in
// the "informational" section — never silently dropped, never force-fit.
const INFORMATIONAL = {
  "androidx.compose:compose-bom":
    "Compose BOM — pins Compose *library* versions (ui/material3/foundation). " +
    "AndroidCompat's compose axis is the Compose *compiler*, which since Kotlin 2.0 " +
    "equals the Kotlin version. Reported for context only.",
};

// --- classification ------------------------------------------------------

export function classifyPicks(picks) {
  return picks.map(classifyPick);
}

function classifyPick(pick) {
  if (pick.kind === "plugin") {
    const axis = PLUGIN_MAP[pick.id] || null;
    if (axis) return { pick, axis, bucket: bucketFor(axis), note: null };
    return {
      pick,
      axis: null,
      bucket: "untracked",
      note: `plugin "${pick.id}" is not tracked by AndroidCompat`,
    };
  }

  const coord = `${pick.group}:${pick.name}`;
  if (INFORMATIONAL[coord]) {
    return {
      pick,
      axis: null,
      bucket: "informational",
      note: INFORMATIONAL[coord],
    };
  }

  const axis = ARTIFACT_MAP[coord] || null;
  if (axis) return { pick, axis, bucket: bucketFor(axis), note: null };

  // androidx.compose.* libraries (ui, material3, foundation, runtime, ...)
  if (
    pick.group === "androidx.compose" ||
    pick.group.startsWith("androidx.compose.")
  ) {
    return {
      pick,
      axis: null,
      bucket: "informational",
      note:
        "Compose *library* artifact — usually BOM-managed, and not the compose axis " +
        "AndroidCompat tracks (the Compose compiler, derived from Kotlin).",
    };
  }

  return {
    pick,
    axis: null,
    bucket: "untracked",
    note: `${coord} is not tracked by AndroidCompat`,
  };
}

function bucketFor(axis) {
  if (CORE_AXES.includes(axis)) return "core";
  if (LIB_AXES.includes(axis)) return "library";
  if (OBSERVED_AXES.includes(axis)) return "observed";
  return "untracked";
}

// --- lookup input assembly (step 2.3: feed the EXISTING engine, unchanged) --

export function buildLookupInput(classified) {
  const core = { agp: "", gradle: "", kotlin: "", ksp: "" };
  const libs = {};
  const conflicts = [];
  const byAxis = {};

  for (const c of classified) {
    if (!c.axis || c.bucket === "observed" || c.bucket === "informational")
      continue;

    const version = c.pick.version;
    if (!version) {
      c.bucket = "informational";
      c.note =
        (c.note ? c.note + " " : "") +
        "No explicit version in the catalog (likely BOM/platform-managed) — nothing to evaluate.";
      continue;
    }

    const prev = byAxis[c.axis];
    if (prev && prev.version !== version) {
      conflicts.push({
        axis: c.axis,
        versions: [prev.version, version],
        picks: [describePick(prev.pick), describePick(c.pick)],
        note: `Lockstep artifacts disagree on the ${c.axis} axis — this alone can break the build.`,
      });
    }
    // keep the highest declared version for lookup; the conflict is reported either way
    if (!prev || compareVersions(version, prev.version) > 0) {
      byAxis[c.axis] = { version, pick: c.pick };
    }
  }

  for (const [axis, entry] of Object.entries(byAxis)) {
    if (CORE_AXES.includes(axis)) core[axis] = entry.version;
    else libs[axis] = entry.version;
  }

  return { input: { core, libs }, conflicts };
}

export function describePick(pick) {
  return pick.kind === "plugin"
    ? `plugins.${pick.refName} (${pick.id})`
    : `libraries.${pick.refName} (${pick.group}:${pick.name})`;
}

export function missingAxes(core, libs) {
  const missing = [];
  for (const a of CORE_AXES) if (!core[a]) missing.push(a);
  for (const a of LIB_AXES) if (!libs[a]) missing.push(a);
  return missing;
}
