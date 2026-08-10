package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// LibCoord represents a single library dependency (reusable across inject/collect)
type LibCoord struct {
	Group    string `json:"group"`
	Artifact string `json:"artifact"`
	Version  string `json:"version"`
}

func main() {
	dir := flag.String("dir", "", "Build directory")
	agp := flag.String("agp", "", "AGP version")
	gradle := flag.String("gradle", "", "Gradle version")
	kotlin := flag.String("kotlin", "", "Kotlin version")
	ksp := flag.String("ksp", "", "KSP version")
	compileSdk := flag.String("compile-sdk", "", "compileSdk version")
	agpMajor := flag.Int("agp-major", 0, "AGP major version (8 or 9)")
	libsJSON := flag.String("libs", "[]", "JSON array of libraries: [{\"group\":\"x\",\"artifact\":\"y\",\"version\":\"z\"}]")
	flag.Parse()

	// Normalize: jq outputs the literal string "null" for missing JSON keys (AGP 9 has no ksp)
	if *ksp == "null" {
		*ksp = ""
	}

	// Core flags always required
	if *dir == "" || *agp == "" || *gradle == "" || *kotlin == "" || *agpMajor == 0 || *compileSdk == "" {
		log.Fatal("All flags are required: --dir, --agp, --gradle, --kotlin, --compile-sdk, --agp-major")
	}

	// KSP required only for AGP 8 (AGP 9 uses built-in Kotlin, no external KSP)
	if *agpMajor != 9 && *ksp == "" {
		log.Fatal("--ksp is required for AGP 8")
	}

	// Parse dynamic libraries
	var libs []LibCoord
	if err := json.Unmarshal([]byte(*libsJSON), &libs); err != nil {
		log.Fatalf("Failed to parse --libs JSON: %v", err)
	}

	// AGP 8/9: Kotlin DSL with libs.versions.toml
	tomlPath := filepath.Join(*dir, "gradle", "libs.versions.toml")
	content, err := os.ReadFile(tomlPath)
	if err != nil {
		log.Fatalf("Failed to read toml: %v", err)
	}
	tomlStr := string(content)

	// 1. Core TOML updates
	tomlStr = replaceInString(tomlStr, `agp\s*=\s*".*"`, fmt.Sprintf(`agp = "%s"`, *agp))
	tomlStr = replaceInString(tomlStr, `kotlin\s*=\s*".*"`, fmt.Sprintf(`kotlin = "%s"`, *kotlin))

	// KSP — skip for AGP 9 (built-in Kotlin conflicts with external KSP plugin)
	if *ksp != "" && *agpMajor != 9 {
		tomlStr = injectTomlVersion(tomlStr, "ksp", *ksp)
		tomlStr = injectTomlPlugin(tomlStr, "ksp", "com.google.devtools.ksp", "ksp")
	}

	if err := os.WriteFile(tomlPath, []byte(tomlStr), 0644); err != nil {
		log.Fatalf("Failed to write toml: %v", err)
	}

	// 2. App build.gradle.kts injections
	appGradleKts := filepath.Join(*dir, "app", "build.gradle.kts")
	appContent, _ := os.ReadFile(appGradleKts)
	appStr := string(appContent)
	appStr = replaceInString(appStr, `compileSdk\s*=\s*\d+`, fmt.Sprintf(`compileSdk = %s`, *compileSdk))
	appStr = replaceInString(appStr, `targetSdk\s*=\s*\d+`, fmt.Sprintf(`targetSdk = %s`, *compileSdk))

	if *agpMajor != 9 {
		appStr = injectAppPluginKts(appStr, "alias(libs.plugins.ksp)")
	}

	// Dynamic library injection (Level 1 generic build)
	if len(libs) > 0 {
		var depLines []string
		for _, lib := range libs {
			depLines = append(depLines, fmt.Sprintf(`    implementation("%s:%s:%s")`, lib.Group, lib.Artifact, lib.Version))
		}
		depsBlock := strings.Join(depLines, "\n")
		appStr = injectAppDependencyKts(appStr, depsBlock)
	}

	if err := os.WriteFile(appGradleKts, []byte(appStr), 0644); err != nil {
		log.Fatalf("Failed to update app/build.gradle.kts: %v", err)
	}

	// 3. Root build.gradle.kts injections
	rootGradleKts := filepath.Join(*dir, "build.gradle.kts")
	rootContent, _ := os.ReadFile(rootGradleKts)
	rootStr := string(rootContent)

	if *agpMajor != 9 {
		rootStr = injectRootPluginKts(rootStr, "alias(libs.plugins.ksp)")
	}

	if err := os.WriteFile(rootGradleKts, []byte(rootStr), 0644); err != nil {
		log.Fatalf("Failed to update root build.gradle.kts: %v", err)
	}

	// 4. Update gradle-wrapper.properties
	wrapperPath := filepath.Join(*dir, "gradle", "wrapper", "gradle-wrapper.properties")
	if err := replaceInFile(wrapperPath, map[string]string{
		`distributionUrl=.*`: fmt.Sprintf(`distributionUrl=https\://services.gradle.org/distributions/gradle-%s-bin.zip`, *gradle),
	}); err != nil {
		log.Fatalf("Failed to update wrapper: %v", err)
	}

	fmt.Printf("✅ Injection complete (foundation + %d dynamic libraries)\n", len(libs))
}

// ---------- Helpers ----------

func replaceInFile(filePath string, replacements map[string]string) error {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}
	newContent := string(content)
	for pattern, replacement := range replacements {
		re, err := regexp.Compile(pattern)
		if err != nil {
			return err
		}
		newContent = re.ReplaceAllString(newContent, replacement)
	}
	return os.WriteFile(filePath, []byte(newContent), 0644)
}

func replaceInString(content, pattern, replacement string) string {
	re := regexp.MustCompile(pattern)
	return re.ReplaceAllString(content, replacement)
}

func injectTomlVersion(content, key, version string) string {
	if version == "" {
		return content
	}
	// Try to replace existing key first
	reReplace := regexp.MustCompile(fmt.Sprintf(`(?m)^%s\s*=\s*".*"$`, regexp.QuoteMeta(key)))
	if reReplace.MatchString(content) {
		return reReplace.ReplaceAllString(content, fmt.Sprintf(`%s = "%s"`, key, version))
	}
	// Fallback: prepend to [versions]
	content = strings.TrimPrefix(content, "\xef\xbb\xbf")
	re := regexp.MustCompile(`(?m)^\[versions\][ \t]*\r?\n`)
	if re.MatchString(content) {
		return re.ReplaceAllString(content, fmt.Sprintf("[versions]\n%s = \"%s\"\n", key, version))
	}
	return fmt.Sprintf("[versions]\n%s = \"%s\"\n\n%s", key, version, content)
}

func injectTomlPlugin(content, alias, id, versionRef string) string {
	if versionRef == "" {
		return content
	}
	if strings.Contains(content, fmt.Sprintf("%s = { id = \"%s\"", alias, id)) {
		return content // Already exists
	}
	re := regexp.MustCompile(`(?m)^\[plugins\][ \t]*\r?\n`)
	if re.MatchString(content) {
		return re.ReplaceAllString(content, fmt.Sprintf("[plugins]\n%s = { id = \"%s\", version.ref = \"%s\" }\n", alias, id, versionRef))
	}
	return content + fmt.Sprintf("\n[plugins]\n%s = { id = \"%s\", version.ref = \"%s\" }\n", alias, id, versionRef)
}

func injectRootPluginKts(content, alias string) string {
	if alias == "" {
		return content
	}
	if strings.Contains(content, fmt.Sprintf("alias(%s) apply false", alias)) {
		return content
	}
	re := regexp.MustCompile(`(?m)^plugins\s*\{`)
	return re.ReplaceAllString(content, fmt.Sprintf("plugins {\n    %s apply false", alias))
}

func injectAppPluginKts(content, alias string) string {
	if alias == "" {
		return content
	}
	if strings.Contains(content, fmt.Sprintf("alias(%s)", alias)) {
		return content
	}
	re := regexp.MustCompile(`(?m)^plugins\s*\{`)
	return re.ReplaceAllString(content, fmt.Sprintf("plugins {\n    %s", alias))
}

func injectAppDependencyKts(content, dependency string) string {
	if dependency == "" {
		return content
	}
	re := regexp.MustCompile(`(?m)^dependencies\s*\{`)
	return re.ReplaceAllString(content, fmt.Sprintf("dependencies {\n%s", dependency))
}
