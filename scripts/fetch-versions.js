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
  gradle: {
    type: "gradle-services",
    url: "https://services.gradle.org/versions/all",
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

// Maven Central Solr Search API — returns versions AND release timestamps
// in a single request. Eliminates the need for per-version POM HEAD requests
// for any artifact hosted on Maven Central (KSP, Hilt).
async function fetchMavenCentralWithDates(groupId, artifactId) {
  const results = [];
  let start = 0;
  const rows = 100;

  while (true) {
    const url = `https://search.maven.org/solrsearch/select?q=g:"${groupId}"+AND+a:"${artifactId}"&rows=${rows}&start=${start}&core=gav&wt=json`;
    const res = await axios.get(url);
    const docs = res.data?.response?.docs ?? [];

    if (!docs.length) break;

    for (const doc of docs) {
      results.push({
        version: doc.v,
        releasedAt: new Date(doc.timestamp).toISOString(),
      });
    }

    if (docs.length < rows) break; // last page
    start += rows;
  }

  return results.filter(({ version: v }) => {
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

  // Paginate through all releases — default API page size is 30,
  // which silently truncates historical versions without this.
  while (true) {
    const separator = url.includes("?") ? "&" : "?";
    const pageUrl = `${url}${separator}per_page=100&page=${page}`;
    const res = await axios.get(pageUrl, { headers: GITHUB_HEADERS });

    if (!res.data.length) break;
    allReleases.push(...res.data);

    if (res.data.length < 100) break; // last page
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

// Gradle's own version service — gives canonical version strings, real
// downloadUrl, release status, and broken flag. Solves the 8.13 vs 8.13.0
// distribution-naming mismatch at the source.
async function fetchGradleVersions(url) {
  const res = await axios.get(url);
  return res.data
    .filter(
      (r) =>
        r.released === true &&
        r.broken === false &&
        r.snapshot === false &&
        r.nightly === false &&
        r.activeRc === false &&
        !r.rcFor &&
        !r.milestoneFor,
    )
    .map((r) => ({
      version: r.version,
      downloadUrl: r.downloadUrl,
      checksumUrl: r.checksumUrl,
      // buildTime format: 20260618231903+0000 -> ISO
      releasedAt: gradleBuildTimeToISO(r.buildTime),
    }));
}

function gradleBuildTimeToISO(buildTime) {
  // "20260618231903+0000" -> "2026-06-18T23:19:03+00:00"
  const m = buildTime.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/,
  );
  if (!m) return null;
  const [, yyyy, mm, dd, HH, MM, SS, tz] = m;
  const tzFormatted = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  return new Date(
    `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}${tzFormatted}`,
  ).toISOString();
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
            registry[component][version].releasedAt = releasedAt;
            dateCount++;
          }
        }

        console.log(
          `  📦 ${component}: ${releases.length} stable versions found`,
        );
      } else if (source.type === "maven-central-solr") {
        // Single request gets versions AND dates — no per-version POM requests needed
        const releases = await fetchMavenCentralWithDates(
          source.groupId,
          source.artifactId,
        );

        for (const { version, releasedAt } of releases) {
          const isNew = !registry[component][version];

          if (isNew) {
            registry[component][version] = {
              version,
              status: "NEW",
              detectedAt: new Date().toISOString(),
              releasedAt,
              source: `https://search.maven.org/solrsearch/select?g:${source.groupId}+a:${source.artifactId}`,
            };
            console.log(
              `  ✅ NEW  ${component} @ ${version} (released: ${releasedAt})`,
            );
            newCount++;
          } else if (!registry[component][version].releasedAt && releasedAt) {
            registry[component][version].releasedAt = releasedAt;
            dateCount++;
          }
        }

        console.log(
          `  📦 ${component}: ${releases.length} stable versions found (Solr API, single request)`,
        );
      } else if (source.type === "gradle-services") {
        const releases = await fetchGradleVersions(source.url);

        for (const {
          version,
          downloadUrl,
          checksumUrl,
          releasedAt,
        } of releases) {
          const isNew = !registry[component][version];

          if (isNew) {
            registry[component][version] = {
              version,
              status: "NEW",
              detectedAt: new Date().toISOString(),
              releasedAt,
              downloadUrl,
              checksumUrl,
              source: source.url,
            };
            console.log(
              `  ✅ NEW  ${component} @ ${version} (released: ${releasedAt})`,
            );
            newCount++;
          } else {
            // Always refresh downloadUrl/checksumUrl in case they change
            registry[component][version].downloadUrl = downloadUrl;
            registry[component][version].checksumUrl = checksumUrl;
            if (!registry[component][version].releasedAt && releasedAt) {
              registry[component][version].releasedAt = releasedAt;
              dateCount++;
            }
          }
        }

        console.log(
          `  📦 ${component}: ${releases.length} stable, downloadable versions found`,
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
