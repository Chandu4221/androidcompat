const fs = require("fs");
const path = require("path");

const TOML_PATH = path.join(
  __dirname,
  "../stub-project/gradle/libs.versions.toml",
);
const REGISTRY_PATH = path.join(__dirname, "../data/version-registry.json");

const REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));

function getGradleDownloadUrl(gradleVersion) {
  const entry = REGISTRY.gradle?.[gradleVersion];
  if (entry?.downloadUrl) return entry.downloadUrl;
  console.warn(
    `  ⚠️  No downloadUrl in registry for Gradle ${gradleVersion}, falling back to constructed URL`,
  );
  return `https://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`;
}

function injectVersions(combo) {
  const toml = `[versions]
agp = "${combo.agp}"
kotlin = "${combo.kotlin}"
ksp = "${combo.ksp}"

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
`;

  fs.writeFileSync(TOML_PATH, toml);

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

  console.log(`✅ Injected: AGP ${combo.agp} | Gradle ${combo.gradle} | Kotlin ${combo.kotlin} | KSP ${combo.ksp}`);
}

const comboArg = process.argv[2];
if (!comboArg) {
  console.error(
    'Usage: node inject-versions.js \'{"agp":"9.2.1","gradle":"9.1.0"}\'',
  );
  process.exit(1);
}

try {
  const combo = JSON.parse(comboArg);
  const required = ["agp", "gradle", "kotlin", "ksp"];
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
