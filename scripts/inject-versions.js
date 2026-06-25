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

function injectVersions(combo) {
  const toml = `[versions]
agp = "${combo.agp}"
kotlin = "${combo.kotlin}"
ksp = "${combo.ksp}"
hilt = "${combo.hilt}"
compose-bom = "${combo.composeBom}"
room = "2.7.1"
coil = "3.2.0"
lifecycle = "2.8.7"
hiltNavigationCompose = "1.2.0"
lifecycleRuntimeCompose = "2.8.7"
coreKtx = "1.16.0"
junit = "4.13.2"
junitVersion = "1.3.0"
espressoCore = "3.7.0"
appcompat = "1.6.1"
material = "1.10.0"
activityKtx = "1.13.0"
constraintlayout = "2.1.4"

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

  // Also inject kotlin version into settings.gradle.kts
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

  const WRAPPER_PATH = path.join(
    __dirname,
    "../stub-project/gradle/wrapper/gradle-wrapper.properties",
  );

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
    `✅ Injected: AGP ${combo.agp} | Kotlin ${combo.kotlin} | KSP ${combo.ksp} | Hilt ${combo.hilt} | Gradle ${combo.gradle} | Compose BOM ${combo.composeBom}`,
  );
}

const comboArg = process.argv[2];
if (!comboArg) {
  console.error(
    'Usage: node inject-versions.js \'{"agp":"9.2.1","kotlin":"2.4.0","ksp":"2.3.9","hilt":"2.59.2","composeBom":"2026.06.00"}\'',
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
