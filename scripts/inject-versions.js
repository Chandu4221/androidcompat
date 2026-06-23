const fs = require('fs');
const path = require('path');

const TOML_PATH = path.join(__dirname, '../stub-project/gradle/libs.versions.toml');

function injectVersions(combo) {
  const toml = `[versions]
agp = "${combo.agp}"
ksp = "${combo.ksp}"
hilt = "${combo.hilt}"
lifecycle = "2.8.7"
coreKtx = "1.19.0"
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
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-compiler", version.ref = "hilt" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
`;

  fs.writeFileSync(TOML_PATH, toml);
  console.log(`✅ Injected: AGP ${combo.agp} | KSP ${combo.ksp} | Hilt ${combo.hilt}`);
}

// Read combo from CLI argument
const comboArg = process.argv[2];
if (!comboArg) {
  console.error('Usage: node inject-versions.js \'{"agp":"9.2.1","ksp":"2.3.9","hilt":"2.59.2"}\'');
  process.exit(1);
}

try {
  const combo = JSON.parse(comboArg);
  const required = ['agp', 'ksp', 'hilt'];
  const missing = required.filter(k => !combo[k]);
  if (missing.length > 0) {
    console.error(`Missing required fields: ${missing.join(', ')}`);
    process.exit(1);
  }
  injectVersions(combo);
} catch (e) {
  console.error('Invalid JSON:', e.message);
  process.exit(1);
}