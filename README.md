# AndroidCompat

**Compile-verified compatibility matrix for Android dependencies.**

Every combination is tested by real Gradle builds — not docs, not guesses.

🔗 **[Live Dashboard →](https://chandu4221.github.io/androidcompat)**

---

## What is this?

Android dependency upgrades are a gamble. AGP, Kotlin, KSP, Hilt, Compose, Room, and Coil all have tight version interdependencies — and the only way to know if a combination works is to actually build it.

AndroidCompat runs nightly CI jobs that compile a real stub Android project against every meaningful version combination and records the result. No guessing. No reading changelogs. Just pass or fail — with explanations.

---

## What it tracks

| Component | Source |
|---|---|
| Android Gradle Plugin (AGP) | Google Maven |
| Kotlin | JetBrains GitHub Releases |
| KSP | Maven Central |
| Hilt / Dagger | Maven Central |
| Compose BOM | Google Maven |
| Gradle Wrapper | Gradle GitHub Releases |

---

## How verification works

Each combination runs through 3 stages:

```
Sync → Compile → Unit Test
```

A combination is only marked `verified` if all 3 stages pass. Failure at any stage is recorded with the exact error, a classified failure signature, and a suggested fix.

---

## Example entry

```json
{
  "agp": "9.2.1",
  "kotlin": "2.3.21",
  "ksp": "2.3.9",
  "hilt": "2.59.1",
  "gradle": "9.6.0",
  "composeBom": "2026.06.00",
  "status": "verified",
  "confidence": {
    "score": 100,
    "level": "high"
  },
  "verification": {
    "sync": "success",
    "compile": "success",
    "unit_test": "success"
  }
}
```

---

## Known failure signals

| Signature | Affected | Description |
|---|---|---|
| `dagger_metadata_error` | Hilt | Hilt's `kotlin-metadata-jvm` doesn't support Kotlin 2.4.0 metadata yet. Downgrade to Kotlin 2.3.x. |
| `ksp_version_mismatch` | KSP | KSP compiled against a different Kotlin version |
| `compose_compiler_mismatch` | Compose | Compose compiler plugin doesn't match Kotlin version |
| `agp_gradle_incompatibility` | AGP | AGP requires a newer Gradle wrapper version |

---

## Current findings

> **Kotlin 2.4.0 + Hilt 2.59.x = broken**
>
> Hilt's bundled `kotlin-metadata-jvm` only supports up to Kotlin metadata 2.3.0.
> Kotlin 2.4.0 emits metadata 2.4.0 which Hilt can't parse.
>
> **Fix:** Stay on Kotlin 2.3.21 until Hilt releases a compatible version.

---

## Data

- [`data/compat.json`](data/compat.json) — full compatibility matrix, updated nightly
- [`data/version-registry.json`](data/version-registry.json) — all known versions per component

---

## How it runs

```
Nightly Scraper (2am IST)
  └── fetch-versions.js      # scrapes latest versions from official sources
  └── generate-candidates.js # generates combos to test, skips already verified

Compile Matrix (triggered on combos update)
  └── inject-versions.js     # injects versions into stub project
  └── Gradle build (32 parallel jobs)
  └── parse-failure.js       # classifies errors into failure signatures
  └── score-confidence.js    # scores each combo 0-100
  └── update-compat.js       # writes results to compat.json
```

---

## Roadmap

- [x] Multi-stage verification pipeline
- [x] Failure signature classifier
- [x] Confidence scoring
- [x] Public dashboard
- [ ] Dependency Doctor — paste `libs.versions.toml`, get instant diagnosis
- [ ] GitHub PR Bot — blocks bad dependency upgrades automatically
- [ ] Upgrade Planner — safe stepping-stone migration paths

---

## License

Data (`data/`) is public domain. Code is MIT.

---

*Built by [@Chandu4221](https://github.com/Chandu4221). Not affiliated with Google or JetBrains.*
