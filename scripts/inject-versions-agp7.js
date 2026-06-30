const fs = require("fs");
const path = require("path");

const TOML_PATH = path.join(
  __dirname,
  "../stub-project-agp7/gradle/libs.versions.toml",
);
const SETTINGS_PATH = path.join(
  __dirname,
  "../stub-project-agp7/settings.gradle.kts",
);
const WRAPPER_PATH = path.join(
  __dirname,
  "../stub-project-agp7/gradle/wrapper/gradle-wrapper.properties",
);
const RULES_PATH = path.join(__dirname, "../data/rules.json");

// ── Load Rules ────────────────────────────────────────────────────────────────

const RULES = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const { pinnedLibraries } = RULES;

// AGP 7 era pinned versions — these are fixed for the historical stub.
// Do NOT use the same pinnedLibraries as AGP 9 (Room 2.7.x needs Kotlin 2.x).
const AGP7_PINNED = {
  room: "2.5.2",
  lifecycle: "2.7.0",
  coreKtx: "1.12.0",
  appcompat: "1.6.1",
  material: "1.10.0",
  constraintlayout: "2.1.4",
  junit: "4.13.2",
  junitExt: "1.1.5",
  espressoCore: "3.5.1",
};

// ── Injector ──────────────────────────────────────────────────────────────────

function injectVersions(combo) {
  const toml = `[versions]
agp = "${combo.agp}"
kotlin = "${combo.kotlin}"
ksp = "${combo.ksp}"
hilt = "${combo.hilt}"
room = "${AGP7_PINNED.room}"
lifecycle = "${AGP7_PINNED.lifecycle}"
coreKtx = "${AGP7_PINNED.coreKtx}"
junit = "${AGP7_PINNED.junit}"
junitVersion = "${AGP7_PINNED.junitExt}"
espressoCore = "${AGP7_PINNED.espressoCore}"
appcompat = "${AGP7_PINNED.appcompat}"
material = "${AGP7_PINNED.material}"
constraintlayout = "${AGP7_PINNED.constraintlayout}"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-appcompat = { group = "androidx.appcompat", name = "appcompat", version.ref = "appcompat" }
material = { group = "com.google.android.material", name = "material", version.ref = "material" }
androidx-constraintlayout = { group = "androidx.constraintlayout", name = "constraintlayout", version.ref = "constraintlayout" }
androidx-lifecycle-viewmodel = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-ktx", version.ref = "lifecycle" }
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-compiler", version.ref = "hilt" }
room-runtime = { group = "androidx.room", name = "room-runtime", version.ref = "room" }
room-ktx = { group = "androidx.room", name = "room-ktx", version.ref = "room" }
room-compiler = { group = "androidx.room", name = "room-compiler", version.ref = "room" }
junit = { group = "junit", name = "junit", version.ref = "junit" }
androidx-junit = { group = "androidx.test.ext", name = "junit", version.ref = "junitVersion" }
androidx-espresso-core = { group = "androidx.test.espresso", name = "espresso-core", version.ref = "espressoCore" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
`;

  fs.writeFileSync(TOML_PATH, toml);

  // Inject into settings.gradle.kts
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

  // Inject Gradle wrapper
  const wrapperContent = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-${combo.gradle}-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;
  fs.writeFileSync(WRAPPER_PATH, wrapperContent);

  console.log(
    `✅ Injected: AGP ${combo.agp} | Kotlin ${combo.kotlin} | KSP ${combo.ksp} | Hilt ${combo.hilt} | Gradle ${combo.gradle}`,
  );
  console.log(`📖 AGP 7 pinned libraries loaded`);
}

// ── Entry Point ───────────────────────────────────────────────────────────────

const comboArg = process.argv[2];
if (!comboArg) {
  console.error(
    'Usage: node inject-versions-agp7.js \'{"agp":"7.4.2","kotlin":"1.9.25","ksp":"1.9.25-1.0.20","hilt":"2.55","gradle":"8.2.1"}\'',
  );
  process.exit(1);
}

try {
  const combo = JSON.parse(comboArg);
  const required = ["agp", "kotlin", "ksp", "hilt", "gradle"];
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
