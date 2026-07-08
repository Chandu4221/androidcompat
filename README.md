# AndroidCompat

**Compile-verified compatibility matrix for Android dependencies.**

[![GitHub Pages](https://img.shields.io/badge/dashboard-live-brightgreen)](https://chandu4221.github.io/androidcompat/)

Every combination is tested by real Gradle builds — not docs, not guesses.

---

## What is this?

Android dependency upgrades are a gamble. AGP, Gradle, Kotlin, KSP, and JDK all have tight version interdependencies — and the only way to know if a combination works is to actually build it.

**AndroidCompat** runs nightly (and on-demand) CI jobs that compile a real stub Android project against every meaningful version combination and records the result. No guessing. No reading changelogs. Just **pass** or **fail** — with explanations.

---

## Live Dashboard

📊 **[View the live compatibility matrix](https://chandu4221.github.io/androidcompat/)**

The dashboard displays all verified and failed combinations across AGP 7, 8, and 9, with:

- Filtering by AGP, Gradle, Kotlin, KSP, and Status
- Stage-by-stage verification status (Sync, Compile, Unit Test)
- Detailed build logs with copy-to-clipboard
- Dark theme optimized for readability
- Real-time stats (verified/failed counts)

---

## How it works

```
1. Candidate generation (Go)
   ↓
   Reads version registry and rules
   ↓
   Generates `combos-to-test.json` per AGP major
   ↓
2. GitHub Actions matrix job
   ↓
   Copies stub template → injects versions → runs Gradle build
   ↓
   Captures stdout/stderr and exit status
   ↓
3. Result aggregation
   ↓
   Merges all matrix results → `compat.json`
   ↓
4. Dashboard (GitHub Pages - Vue.js)
   ↓
   Serves `compat.json` as a visual, filterable matrix
```

---

## What it tracks

| Component                       | Scope                                                  |
| :------------------------------ | :----------------------------------------------------- |
| **Android Gradle Plugin (AGP)** | 7.x, 8.x, 9.x (latest patch per minor)                 |
| **Gradle**                      | Wrapper versions required by AGP rules                 |
| **Kotlin**                      | External plugin versions (AGP7/8) or built‑in (AGP9)   |
| **KSP**                         | Matched to Kotlin version (legacy composite or semver) |
| **JDK**                         | 11 for AGP7, 17 for AGP8/9                             |

---

## Stubs

Each AGP major has its own **isolated stub project** in `stubs/`:

- `stubs/agp7/` – Groovy DSL, JDK 11
- `stubs/agp8/` – Kotlin DSL, version catalog, JDK 17
- `stubs/agp9/` – Kotlin DSL, built‑in Kotlin, JDK 17

The stub serves as a **template**. During CI, it is copied, versions are injected, and Gradle builds are run – the original stubs are never mutated.

---

## Candidate generation

The generator (`cmd/gencombos/`) applies a chain of deterministic constraints:

1. **AGP**: collapse to latest patch per minor line.
2. **Gradle**: exact lookup from official AGP↔Gradle table.
3. **JDK**: exact lookup from official AGP↔JDK table.
4. **Kotlin**:
   - AGP9: fixed built‑in version (implied).
   - AGP7/8: intersect official Kotlin bytecode floors and external‑plugin Gradle/AGP compatibility ranges → collapse to latest patch per minor.
5. **KSP**: deterministically resolved from Kotlin version (legacy composite or semver).

No date‑based heuristics are used for validity – only official compatibility tables.

---

## Workflows

Three manual‑trigger workflows are available:

- **Verify AGP 9.x** – 3 combos
- **Verify AGP 8.x** – 7 combos
- **Verify AGP 7.x** – 2 combos

Each workflow:

1. Reads the pre‑generated `combos-to-test.json`.
2. Spawns a matrix job for every combo.
3. Injects versions, runs Gradle, captures output.
4. Aggregates results into `compat.json`.
5. Commits and pushes the updated results.

The results are automatically synced to `docs/data/` and deployed to GitHub Pages.

---

## Data files

| File                                | Purpose                                                            |
| :---------------------------------- | :----------------------------------------------------------------- |
| `data/agp{N}/combos-to-test.json`   | Candidate combos for AGP major `N`                                 |
| `data/agp{N}/compat.json`           | Verification results                                               |
| `data/shared/version-registry.json` | All component versions and release dates                           |
| `data/shared/rules.json`            | Official compatibility rules (AGP↔Gradle/JDK, Kotlin floors, etc.) |

---

## Local usage

### Generate combos

```bash
go run cmd/gencombos/main.go --agp=9 --fetch=true
```

### Run a single combo locally (example)

```bash
mkdir -p tmp-build
cp -r stubs/agp9/* tmp-build/
go run cmd/inject/main.go \
  --dir=tmp-build \
  --agp=9.0.1 \
  --gradle=9.1.0 \
  --kotlin=2.2.10 \
  --ksp=2.2.10-2.0.2 \
  --agp-major=9
cd tmp-build
./gradlew build
```

### Aggregate results (example)

```bash
go run cmd/aggregate/main.go --agp=9 --results-dir=results/
```

---

## Dashboard

The dashboard is built with **Vue.js** and **Tailwind CSS**, and is deployed via GitHub Pages from the `docs/` folder.

It displays:

- Total builds, verified, failed, and pass rate.
- Full table with AGP, Gradle, Kotlin, KSP, JDK, and stage‑by‑stage verification status.
- Filterable by any version or status.
- Detailed build logs with copy-to-clipboard functionality.
- Dark theme with Android-inspired accent colors.

---

## License

Data (`data/`) is public domain. Code is MIT.

---

_Built by [@Chandu4221](https://github.com/Chandu4221). Not affiliated with Google or JetBrains._
