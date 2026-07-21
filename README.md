# AndroidCompat

[![dashboard](https://img.shields.io/badge/dashboard-live-brightgreen)](https://chandu4221.github.io/androidcompat/)

**Compile-verified compatibility matrix for Android dependencies.**

Android dependency upgrades are often a gamble. AGP, Gradle, Kotlin, KSP, JDK, and various AndroidX libraries have tight version interdependencies. The only way to know if a combination truly works is to actually build it.

AndroidCompat runs automated CI jobs that compile a real stub Android project against every meaningful version combination and records the results. No guessing. No reading changelogs. Just pass or fail — with intelligent error classification and empirical proof.

## 📊 Live Dashboard

[**View the Live Compatibility Matrix**](https://chandu4221.github.io/androidcompat/)

Our interactive dashboard parses the test results (`compat.json`) and provides a rich UI for developers:
- **Card-Based Interface**: View detailed environment setups, library versions, and build status (Verified or Failed).
- **Advanced Filtering**: Narrow down results by specific versions of AGP, Gradle, Kotlin, KSP, JDK, API Level (compileSdk), or Libraries (e.g., Core KTX).
- **"Show Only Core Toolchain"**: A quick toggle to hide third-party libraries and focus solely on core Android build tools.
- **Detailed Build Logs**: Click into any run to view the full verification logs in a modal without leaving the page.
- **GitHub Workflow Links**: Instantly jump from a test result to the raw GitHub Actions CI run that produced it for absolute transparency.

## ⚙️ How it Works

AndroidCompat is powered by a robust backend architecture running on GitHub Actions:

1. **Candidate Injection (`cmd/inject`)**
   Reads a matrix of pre-generated combos (`combos-to-test.json`). It injects these exact versions into isolated, real Android stub projects (`stubs/agp7`, `stubs/agp8`, `stubs/agp9`).
2. **Gradle Tooling API Bridge**
   Executes the build using a custom Gradle Tooling API bridge (with retry logic) to capture structured JSON output instead of messy console logs.
3. **Intelligent Error Classification (`cmd/collect`)**
   Parses the build output and intelligently classifies failures into distinct signatures (e.g., `hilt_ksp_scoping_error`, `compile_sdk_mismatch`).
4. **Aggregation (`cmd/aggregate`)**
   Merges thousands of individual test outcomes into a single `compat.json` payload, which is deployed to GitHub Pages to power the Dashboard.

## 📦 What We Track

AndroidCompat tracks compatibility using a two-layer model:

### Layer 1: Core Toolchain
- **Android Gradle Plugin (AGP)**: 7.x, 8.x, 9.x (latest patch per minor)
- **Gradle**: Resolved via official bounds
- **Kotlin**: External plugin versions (AGP7/8) or built-in (AGP9)
- **KSP**: Semver matched to Kotlin
- **JDK**: 11 or 17
- **API Level (compileSdk)**: Extracted minimum bounds from libraries.

### Layer 2: Libraries (Optional Add-ons)
- **AndroidX Core KTX**: Dynamically resolved and downgraded based on the `compileSdk` floor.
- **Hilt / Dagger**: Empirically filtered by Gradle metadata floors.
*(More libraries like Navigation, Room, and Compose are being actively phased in.)*

## 💡 Local Usage

You can run the engine locally to test specific combinations:

```bash
# Setup a temporary stub for AGP 9
mkdir -p tmp-build
cp -r stubs/agp9/* tmp-build/

# Inject versions
go run cmd/inject/main.go \
  --dir=tmp-build \
  --agp=9.0.1 \
  --gradle=9.1.0 \
  --kotlin=2.2.10 \
  --ksp=2.2.10-2.0.2 \
  --agp-major=9

# Execute the test
cd tmp-build
./gradlew build
```

## 📜 License

Data (`data/`) is public domain. Code is MIT.

Built by [@Chandu4221](https://github.com/Chandu4221). Not affiliated with Google or JetBrains.
