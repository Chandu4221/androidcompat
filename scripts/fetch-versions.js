require('dotenv').config();
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '../data/version-registry.json');
const parser = new XMLParser();

const GITHUB_HEADERS = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
};

// ── Sources ──────────────────────────────────────────────────────────────────

const SOURCES = {
  agp: {
    type: 'google-maven',
    url: 'https://dl.google.com/android/maven2/com/android/tools/build/gradle/maven-metadata.xml',
  },
  ksp: {
    type: 'maven-central',
    url: 'https://repo1.maven.org/maven2/com/google/devtools/ksp/symbol-processing-api/maven-metadata.xml',
  },
  hilt: {
    type: 'maven-central',
    url: 'https://repo1.maven.org/maven2/com/google/dagger/hilt-android/maven-metadata.xml',
  },
  composeBom: {
    type: 'google-maven',
    url: 'https://dl.google.com/android/maven2/androidx/compose/compose-bom/maven-metadata.xml',
  },
  kotlin: {
    type: 'github-releases',
    url: 'https://api.github.com/repos/JetBrains/kotlin/releases',
  },
  gradle: {
    type: 'github-releases',
    url: 'https://api.github.com/repos/gradle/gradle/releases',
  },
};

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchMavenVersions(url) {
  const res = await axios.get(url);
  const parsed = parser.parse(res.data);
  const versions = parsed?.metadata?.versioning?.versions?.version ?? [];
  const list = Array.isArray(versions) ? versions : [versions];
  return list
    .map(String)
    .filter(v => {
      const lower = v.toLowerCase();
      return !lower.includes('alpha') &&
             !lower.includes('beta') &&
             !lower.includes('rc') &&
             !lower.includes('-m1') &&
             !lower.includes('-m2');
    });
}

async function fetchGithubVersions(url) {
  const res = await axios.get(url, { headers: GITHUB_HEADERS });
  return res.data
    .filter(r => !r.prerelease && !r.draft)
    .map(r => r.tag_name.replace(/^v/, ''))
    .filter(v => !v.includes('alpha') && !v.includes('beta') && !v.includes('rc') && !v.includes('M'));
}

// ── Registry helpers ──────────────────────────────────────────────────────────

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Fetching latest versions from official sources...\n');
  const registry = loadRegistry();
  let newCount = 0;

  for (const [component, source] of Object.entries(SOURCES)) {
    try {
      let versions = [];

      if (source.type === 'google-maven' || source.type === 'maven-central') {
        versions = await fetchMavenVersions(source.url);
      } else if (source.type === 'github-releases') {
        versions = await fetchGithubVersions(source.url);
      }

      if (!registry[component]) registry[component] = {};

      for (const version of versions) {
        if (!registry[component][version]) {
          registry[component][version] = {
            version,
            status: 'NEW',
            detectedAt: new Date().toISOString(),
            source: source.url,
          };
          console.log(`  ✅ NEW  ${component} @ ${version}`);
          newCount++;
        }
      }

      console.log(`  📦 ${component}: ${versions.length} stable versions found`);
    } catch (err) {
      console.error(`  ❌ Failed to fetch ${component}: ${err.message}`);
    }
  }

  saveRegistry(registry);
  console.log(`\n✅ Done. ${newCount} new versions added to registry.`);
  console.log(`📄 Saved to ${REGISTRY_PATH}`);
}

main();