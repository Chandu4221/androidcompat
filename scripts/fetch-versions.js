require("dotenv").config();
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const path = require("path");

const REGISTRY_PATH = path.join(__dirname, "../data/version-registry.json");
const parser = new XMLParser();

const GITHUB_HEADERS = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
};

// ── Sources ───────────────────────────────────────────────────────────────────

const SOURCES = {
  agp: {
    type: "google-maven",
    url: "https://dl.google.com/android/maven2/com/android/tools/build/gradle/maven-metadata.xml",
    pomBase:
      "https://dl.google.com/android/maven2/com/android/tools/build/gradle",
    pomArtifact: "gradle",
  },
  ksp: {
    type: "maven-central",
    url: "https://repo1.maven.org/maven2/com/google/devtools/ksp/symbol-processing-api/maven-metadata.xml",
    pomBase:
      "https://repo1.maven.org/maven2/com/google/devtools/ksp/symbol-processing-api",
    pomArtifact: "symbol-processing-api",
  },
  hilt: {
    type: "maven-central",
    url: "https://repo1.maven.org/maven2/com/google/dagger/hilt-android/maven-metadata.xml",
    pomBase: "https://repo1.maven.org/maven2/com/google/dagger/hilt-android",
    pomArtifact: "hilt-android",
  },
  composeBom: {
    type: "google-maven",
    url: "https://dl.google.com/android/maven2/androidx/compose/compose-bom/maven-metadata.xml",
    pomBase:
      "https://dl.google.com/android/maven2/androidx/compose/compose-bom",
    pomArtifact: "compose-bom",
  },
  kotlin: {
    type: "github-releases",
    url: "https://api.github.com/repos/JetBrains/kotlin/releases",
  },
  gradle: {
    type: "github-releases",
    url: "https://api.github.com/repos/gradle/gradle/releases",
  },
};

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchMavenVersions(url) {
  const res = await axios.get(url);
  const parsed = parser.parse(res.data);
  const versions = parsed?.metadata?.versioning?.versions?.version ?? [];
  const list = Array.isArray(versions) ? versions : [versions];
  return list.map(String).filter((v) => {
    const lower = v.toLowerCase();
    return (
      !lower.includes("alpha") &&
      !lower.includes("beta") &&
      !lower.includes("rc") &&
      !lower.includes("-m1") &&
      !lower.includes("-m2")
    );
  });
}

async function fetchGithubVersions(url) {
  const allReleases = [];
  let page = 1;

  while (true) {
    const res = await axios.get(`${url}?per_page=100&page=${page}`, {
      headers: GITHUB_HEADERS,
    });

    if (!res.data.length) break;
    allReleases.push(...res.data);

    // Stop if we have enough history — 500 releases covers all Gradle/Kotlin versions
    if (allReleases.length >= 500 || res.data.length < 100) break;
    page++;
  }

  return allReleases
    .filter((r) => !r.prerelease && !r.draft)
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ""),
      releasedAt: r.published_at,
    }))
    .filter(
      ({ version: v }) =>
        !v.includes("alpha") &&
        !v.includes("beta") &&
        !v.includes("rc") &&
        !v.includes("M"),
    );
}

// Fetch releasedAt for a single Maven/Google Maven version via POM Last-Modified header
async function fetchMavenReleasedAt(pomBase, pomArtifact, version) {
  const pomUrl = `${pomBase}/${version}/${pomArtifact}-${version}.pom`;
  try {
    const res = await axios.head(pomUrl);
    const lastModified = res.headers["last-modified"];
    if (lastModified) {
      return new Date(lastModified).toISOString();
    }
  } catch (err) {
    console.warn(
      `    ⚠️  Could not fetch releasedAt for ${pomArtifact}@${version}: ${err.message}`,
    );
  }
  return null;
}

// ── Registry helpers ──────────────────────────────────────────────────────────

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
}

function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Fetching latest versions from official sources...\n");
  const registry = loadRegistry();
  let newCount = 0;
  let dateCount = 0;

  for (const [component, source] of Object.entries(SOURCES)) {
    try {
      if (!registry[component]) registry[component] = {};

      if (source.type === "github-releases") {
        // GitHub gives us dates for free in one request
        const releases = await fetchGithubVersions(source.url);

        for (const { version, releasedAt } of releases) {
          const isNew = !registry[component][version];

          if (isNew) {
            registry[component][version] = {
              version,
              status: "NEW",
              detectedAt: new Date().toISOString(),
              releasedAt,
              source: source.url,
            };
            console.log(
              `  ✅ NEW  ${component} @ ${version} (released: ${releasedAt})`,
            );
            newCount++;
          } else if (!registry[component][version].releasedAt && releasedAt) {
            // Backfill releasedAt for existing entries that are missing it
            registry[component][version].releasedAt = releasedAt;
            console.log(
              `  📅 DATED  ${component} @ ${version} (released: ${releasedAt})`,
            );
            dateCount++;
          }
        }

        console.log(
          `  📦 ${component}: ${releases.length} stable versions found`,
        );
      } else {
        // Maven / Google Maven — need separate POM request per version for date
        const versions = await fetchMavenVersions(source.url);

        for (const version of versions) {
          const isNew = !registry[component][version];
          const needsDate = isNew || !registry[component][version].releasedAt;

          if (isNew) {
            registry[component][version] = {
              version,
              status: "NEW",
              detectedAt: new Date().toISOString(),
              releasedAt: null,
              source: source.url,
            };
            newCount++;
          }

          if (needsDate) {
            process.stdout.write(
              `  📅 Fetching release date for ${component} @ ${version}...`,
            );
            const releasedAt = await fetchMavenReleasedAt(
              source.pomBase,
              source.pomArtifact,
              version,
            );
            registry[component][version].releasedAt = releasedAt;

            if (releasedAt) {
              process.stdout.write(` ${releasedAt}\n`);
              dateCount++;
            } else {
              process.stdout.write(` ⚠️  not found\n`);
            }

            // Small delay to avoid hammering the server
            await new Promise((r) => setTimeout(r, 150));
          }

          if (isNew) {
            console.log(`  ✅ NEW  ${component} @ ${version}`);
          }
        }

        console.log(
          `  📦 ${component}: ${versions.length} stable versions found`,
        );
      }
    } catch (err) {
      console.error(`  ❌ Failed to fetch ${component}: ${err.message}`);
    }
  }

  saveRegistry(registry);
  console.log(
    `\n✅ Done. ${newCount} new versions added, ${dateCount} release dates captured.`,
  );
  console.log(`📄 Saved to ${REGISTRY_PATH}`);
}

main();
