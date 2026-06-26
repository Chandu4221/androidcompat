// parse-failure.js
// Phase B - Failure Signature Classifier
// Converts raw error_log strings into structured failure_analysis objects

const SIGNATURES = [
  {
    signature: "dagger_metadata_error",
    affected_component: "hilt",
    patterns: [
      /Provided Metadata instance has version .+ while maximum supported version is/i,
      /kotlin-metadata-jvm/i,
      /hiltJavaCompile.*FAILED/i,
    ],
    root_cause:
      "Hilt's bundled kotlin-metadata-jvm library does not support the Kotlin metadata version emitted by the current Kotlin compiler. Hilt 2.59.x supports up to Kotlin metadata 2.3.0.",
    fix: "Downgrade to Kotlin 2.3.x, or wait for a Hilt release that bundles a newer kotlin-metadata-jvm.",
  },
  {
    signature: "ksp_version_mismatch",
    affected_component: "ksp",
    patterns: [
      /KSP daemon startup failed/i,
      /Incompatible Kotlin version/i,
      /ksp.*incompatible/i,
      /symbol-processing.*version/i,
    ],
    root_cause:
      "The KSP version is compiled against a different Kotlin compiler version than what the project is using.",
    fix: "Align KSP version with the Kotlin compiler version. Check https://github.com/google/ksp/releases for compatible pairs.",
  },
  {
    signature: "compose_compiler_mismatch",
    affected_component: "compose",
    patterns: [
      /The Kotlin Gradle plugin was loaded multiple times/i,
      /Compose compiler plugin.*not compatible/i,
      /compose.*compiler.*version/i,
      /ComposeCompilerPluginCommandLineProcessor/i,
    ],
    root_cause:
      "The Compose compiler plugin version does not match the Kotlin compiler version being used.",
    fix: "Use the kotlin.plugin.compose Gradle plugin which auto-aligns the Compose compiler with the Kotlin version.",
  },
  {
    signature: "agp_gradle_incompatibility",
    affected_component: "agp",
    patterns: [
      /Minimum supported Gradle version is/i,
      /Current Gradle version/i,
      /upgrade your version of Gradle/i,
      /Android Gradle plugin requires Java/i,
    ],
    root_cause:
      "The Android Gradle Plugin version requires a newer Gradle wrapper version than what is configured.",
    fix: "Update gradle-wrapper.properties to use a Gradle version that meets the AGP minimum requirement.",
  },
  {
    signature: "room_schema_error",
    affected_component: "room",
    patterns: [
      /Schema export directory is not provided/i,
      /room.*schema/i,
      /Cannot find.*RoomDatabase/i,
    ],
    root_cause:
      "Room KSP processing failed due to missing schema export configuration or incompatible Room version.",
    fix: "Add room.schemaLocation to KSP arguments, or align Room version with the current KSP/Kotlin version.",
  },
  {
    signature: "hilt_component_error",
    affected_component: "hilt",
    patterns: [
      /\[Hilt\] Processing environment.*not compatible/i,
      /hiltAggregateDeps.*FAILED/i,
      /MissingBinding/i,
      /\[Hilt\].*error/i,
    ],
    root_cause:
      "Hilt annotation processing failed during component generation. This may indicate a version mismatch or missing binding.",
    fix: "Check Hilt version compatibility with the current Kotlin and KSP versions.",
  },
];

const UNKNOWN_SIGNATURE = {
  signature: "unknown",
  affected_component: "unknown",
  root_cause: "Could not match the error log to a known failure signature.",
  fix: "Review the full CI log for more details.",
};

/**
 * Parses a raw error log string and returns a structured failure_analysis object.
 * @param {string} errorLog - raw error log string
 * @returns {object} failure_analysis
 */
function parseFailure(errorLog) {
  if (!errorLog || errorLog.trim() === "") {
    return null; // No error log means no failure to classify
  }

  for (const sig of SIGNATURES) {
    const matched = sig.patterns.some((pattern) => pattern.test(errorLog));
    if (matched) {
      return {
        signature: sig.signature,
        affected_component: sig.affected_component,
        root_cause: sig.root_cause,
        fix: sig.fix,
      };
    }
  }

  return {
    signature: UNKNOWN_SIGNATURE.signature,
    affected_component: UNKNOWN_SIGNATURE.affected_component,
    root_cause: UNKNOWN_SIGNATURE.root_cause,
    fix: UNKNOWN_SIGNATURE.fix,
  };
}

module.exports = { parseFailure };
