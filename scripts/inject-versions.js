const fs = require("fs");
const path = require("path");

const TOML_PATH = path.join(
  __dirname,
  "../stub-project/gradle/libs.versions.toml",
);
const SETTINGS_PATH = path.join(
  __dirname,
  "../stub-project/settings.gradle.kts",
);
const RULES_PATH = path.join(__dirname, "../data/rules.json");
const REGISTRY_PATH = path.join(__dirname, "../data/version-registry.json");

// ── Load Rules & Registry ────────────────────────────────────────────────────

const RULES = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const { pinnedLibraries } = RULES;
const REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));

// ── Legacy Kotlin Compose Compiler Map ────────────────────────────────────────
// Maps Kotlin 1.x versions to their required Compose Compiler version.
// Not needed for Kotlin 2.0+ which uses the 'org.jetbrains.kotlin.plugin.compose' Gradle plugin.
const KOTLIN_TO_COMPOSE_COMPILER = {
  "1.9.24": "1.5.14",
  "1.9.23": "1.5.11",
  "1.9.22": "1.5.10",
  "1.9.21": "1.5.8",
  "1.9.20": "1.5.4",
  "1.9.10": "1.5.3",
  "1.9.0": "1.5.1",
  "1.8.22": "1.4.8",
  "1.8.21": "1.4.7",
  "1.8.20": "1.4.6",
  "1.8.10": "1.4.3",
  "1.8.0": "1.4.0",
  "1.7.22": "1.3.2",
  "1.7.21": "1.3.2",
  "1.7.20": "1.3.2"
};

// Look up Gradle's canonical downloadUrl from the registry instead of
// constructing it from the version string. Gradle distribution filenames
// are inconsistent (e.g. "8.13" not "8.13.0"), so the registry — populated
// from services.gradle.org/versions/all — is the source of truth.
function getGradleDownloadUrl(gradleVersion) {
  const entry = REGISTRY.gradle?.[gradleVersion];
  if (entry?.downloadUrl) return entry.downloadUrl;
  // Fallback: construct it (may fail for inconsistent versions, but better than nothing)
  console.warn(
    `  ⚠️  No downloadUrl in registry for Gradle ${gradleVersion}, falling back to constructed URL`,
  );
  return `https://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`;
}

// ── Injector ──────────────────────────────────────────────────────────────────

function injectVersions(combo) {
  const toml = `[versions]
agp = "${combo.agp}"
kotlin = "${combo.kotlin}"
ksp = "${combo.ksp}"
hilt = "${combo.hilt}"
compose-bom = "${combo.composeBom}"
room = "${pinnedLibraries.room}"
coil = "${pinnedLibraries.coil}"
lifecycle = "${pinnedLibraries.lifecycle}"
hiltNavigationCompose = "${pinnedLibraries.hiltNavigationCompose}"
lifecycleRuntimeCompose = "${pinnedLibraries.lifecycleRuntimeCompose}"
coreKtx = "${pinnedLibraries.coreKtx}"
junit = "${pinnedLibraries.junit}"
junitVersion = "${pinnedLibraries.junitExt}"
espressoCore = "${pinnedLibraries.espressoCore}"
appcompat = "${pinnedLibraries.appcompat}"
material = "${pinnedLibraries.material}"
activityKtx = "${pinnedLibraries.activityKtx}"
constraintlayout = "${pinnedLibraries.constraintlayout}"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
junit = { group = "junit", name = "junit", version.ref = "junit" }
androidx-junit = { group = "androidx.test.ext", name = "junit", version.ref = "junitVersion" }
androidx-espresso-core = { group = "androidx.test.espresso", name = "espresso-core", version.ref = "espressoCore" }
androidx-appcompat = { group = "androidx.appcompat", name = "appcompat", version.ref = "appcompat" }
material = { group = "com.google.android.material", name = "material", version.ref = "material" }
androidx-activity-ktx = { group = "androidx.activity", name = "activity-ktx", version.ref = "activityKtx" }
androidx-constraintlayout = { group = "androidx.constraintlayout", name = "constraintlayout", version.ref = "constraintlayout" }
androidx-lifecycle-viewmodel = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-ktx", version.ref = "lifecycle" }
androidx-lifecycle-runtime-compose = { group = "androidx.lifecycle", name = "lifecycle-runtime-compose", version.ref = "lifecycleRuntimeCompose" }
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-compiler", version.ref = "hilt" }
hilt-navigation-compose = { group = "androidx.hilt", name = "hilt-navigation-compose", version.ref = "hiltNavigationCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "compose-bom" }
androidx-compose-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-compose-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-compose-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityKtx" }
room-runtime = { group = "androidx.room", name = "room-runtime", version.ref = "room" }
room-ktx = { group = "androidx.room", name = "room-ktx", version.ref = "room" }
room-compiler = { group = "androidx.room", name = "room-compiler", version.ref = "room" }
coil-compose = { group = "io.coil-kt.coil3", name = "coil-compose", version.ref = "coil" }
coil-network-okhttp = { group = "io.coil-kt.coil3", name = "coil-network-okhttp", version.ref = "coil" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
`;

  fs.writeFileSync(TOML_PATH, toml);

  // Inject versions into settings.gradle.kts
  let settings = fs.readFileSync(SETTINGS_PATH, "utf8");
  settings = settings.replace(
    /id\("org\.jetbrains\.kotlin\.android"\) version "[^"]+"/,
    `id("org.jetbrains.kotlin.android") version "${combo.kotlin}"`,
  );
  settings = settings.replace(
    /id\("com\.google\.devtools\.ksp"\) version "[^"]+"/,
    `id("com.google.devtools.ksp") version "${combo.ksp}"`,
  );
  settings = settings.replace(
    /id\("com\.google\.dagger\.hilt\.android"\) version "[^"]+"/,
    `id("com.google.dagger.hilt.android") version "${combo.hilt}"`,
  );
  fs.writeFileSync(SETTINGS_PATH, settings);

  // Inject Gradle wrapper version
  const WRAPPER_PATH = path.join(
    __dirname,
    "../stub-project/gradle/wrapper/gradle-wrapper.properties",
  );
  const gradleDownloadUrl = getGradleDownloadUrl(combo.gradle);
  const escapedUrl = gradleDownloadUrl.replace(/:/g, "\\:");
  const wrapperContent = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=${escapedUrl}
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;
  fs.writeFileSync(WRAPPER_PATH, wrapperContent);

  // ── Dynamic Polyfill for build.gradle.kts ─────────────────────────────
  // Fixes the Kotlin 1.x compiler bug by stripping the modern plugin
  // and injecting the legacy composeOptions block on the fly.
  const BUILD_GRADLE_PATH = path.join(__dirname, "../stub-project/app/build.gradle.kts");
  let buildGradle = fs.readFileSync(BUILD_GRADLE_PATH, "utf8");

  if (combo.kotlin.startsWith("1.")) {
    // Legacy Kotlin 1.x
    // 1. Remove Kotlin 2.x Compose plugin
    buildGradle = buildGradle.replace(/\s*alias\(libs\.plugins\.kotlin\.compose\)/g, "");
    
    // 2. Inject composeOptions into android block if not present
    const compilerVersion = KOTLIN_TO_COMPOSE_COMPILER[combo.kotlin] || "1.5.14";
    if (!buildGradle.includes("composeOptions {")) {
      buildGradle = buildGradle.replace(
        "    buildFeatures {", 
        `    composeOptions {\n        kotlinCompilerExtensionVersion = "${compilerVersion}"\n    }\n    buildFeatures {`
      );
    } else {
      buildGradle = buildGradle.replace(/kotlinCompilerExtensionVersion\s*=\s*"[^"]+"/, `kotlinCompilerExtensionVersion = "${compilerVersion}"`);
    }
  } else {
    // Modern Kotlin 2.x
    // 1. Ensure Kotlin 2.x Compose plugin is present
    if (!buildGradle.includes("alias(libs.plugins.kotlin.compose)")) {
      buildGradle = buildGradle.replace(
        "    alias(libs.plugins.hilt)", 
        "    alias(libs.plugins.hilt)\n    alias(libs.plugins.kotlin.compose)"
      );
    }
    // 2. Remove any legacy composeOptions block
    buildGradle = buildGradle.replace(/\s*composeOptions\s*\{[\s\S]*?\}/g, "");
  }
  
  fs.writeFileSync(BUILD_GRADLE_PATH, buildGradle);

  console.log(
    `✅ Injected: AGP ${combo.agp} | Kotlin ${combo.kotlin} | KSP ${combo.ksp} | Hilt ${combo.hilt} | Gradle ${combo.gradle} | Compose BOM ${combo.composeBom}`,
  );
  console.log(`📖 Pinned libraries loaded from rules.json`);
}

// ── Entry Point ───────────────────────────────────────────────────────────────

const comboArg = process.argv[2];
if (!comboArg) {
  console.error(
    'Usage: node inject-versions.js \'{"agp":"9.2.1","kotlin":"2.4.0","ksp":"2.3.9","hilt":"2.59.2","gradle":"9.1.0","composeBom":"2026.06.00"}\'',
  );
  process.exit(1);
}

try {
  const combo = JSON.parse(comboArg);
  const required = ["agp", "kotlin", "ksp", "hilt", "composeBom", "gradle"];
  const missing = required.filter((k) => !combo[k]);
  if (missing.length > 0) {
    console.error(`Missing required fields: ${missing.join(", ")}`);
    process.exit(1);
  }
  injectVersions(combo);
} catch (e) {
  console.error("Invalid JSON:", e.message);
  process.exit(1);
}
