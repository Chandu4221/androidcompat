package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func main() {
	dir := flag.String("dir", "", "Build directory")
	agp := flag.String("agp", "", "AGP version")
	gradle := flag.String("gradle", "", "Gradle version")
	kotlin := flag.String("kotlin", "", "Kotlin version")
	ksp := flag.String("ksp", "", "KSP version")
	compileSdk := flag.String("compile-sdk", "", "compileSdk version")
	agpMajor := flag.Int("agp-major", 0, "AGP major version (7, 8, or 9)")
	hilt := flag.String("hilt", "", "Hilt version (optional)")
	room := flag.String("room", "", "Room version (optional)")
	navigation := flag.String("navigation", "", "Navigation version (optional)")
	composeCompiler := flag.String("compose-compiler", "", "Compose compiler version (optional)")
	flag.Parse()

	if *dir == "" || *agp == "" || *gradle == "" || *kotlin == "" || *ksp == "" || *agpMajor == 0 || *compileSdk == "" {
		log.Fatal("All flags are required: --dir, --agp, --gradle, --kotlin, --ksp, --compile-sdk, --agp-major")
	}

	if *agpMajor == 7 {
		// AGP7: Groovy DSL
		// 1. Update root build.gradle (classpath versions)
		rootGradle := filepath.Join(*dir, "build.gradle")
		if err := replaceInFile(rootGradle, map[string]string{
			`classpath "com.android.tools.build:gradle:[^"]*"`:            fmt.Sprintf(`classpath "com.android.tools.build:gradle:%s"`, *agp),
			`classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:[^"]*"`: fmt.Sprintf(`classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:%s"`, *kotlin),
		}); err != nil {
			log.Fatalf("Failed to update root build.gradle: %v", err)
		}

		// 2. Update app/build.gradle (compileSdk, Kotlin plugin version, and KSP plugin)
		appGradle := filepath.Join(*dir, "app", "build.gradle")
		if err := replaceInFile(appGradle, map[string]string{
			`compileSdk\s+\d+`:                    fmt.Sprintf(`compileSdk %s`, *compileSdk),
			`id 'kotlin-android' version '[^']*'`: fmt.Sprintf(`id 'kotlin-android' version '%s'`, *kotlin),
		}); err != nil {
			log.Printf("Warning: could not update app/build.gradle: %v", err)
		}
		// Add KSP plugin if not present
		if err := ensureKSPPluginGroovy(appGradle, *ksp); err != nil {
			log.Printf("Warning: could not add KSP plugin: %v", err)
		}

		// 3. Update gradle-wrapper.properties
		wrapperPath := filepath.Join(*dir, "gradle", "wrapper", "gradle-wrapper.properties")
		if err := replaceInFile(wrapperPath, map[string]string{
			`distributionUrl=.*`: fmt.Sprintf(`distributionUrl=https\://services.gradle.org/distributions/gradle-%s-bin.zip`, *gradle),
		}); err != nil {
			log.Fatalf("Failed to update wrapper: %v", err)
		}

		fmt.Println("✅ Injection complete for AGP7 (Groovy DSL)")
	} else {
		// AGP8/9: Kotlin DSL with libs.versions.toml
		tomlPath := filepath.Join(*dir, "gradle", "libs.versions.toml")
		content, err := os.ReadFile(tomlPath)
		if err != nil {
			log.Fatalf("Failed to read toml: %v", err)
		}
		tomlStr := string(content)

		// 1. Core updates
		tomlStr = replaceInString(tomlStr, `agp\s*=\s*".*"`, fmt.Sprintf(`agp = "%s"`, *agp))
		tomlStr = replaceInString(tomlStr, `kotlin\s*=\s*".*"`, fmt.Sprintf(`kotlin = "%s"`, *kotlin))

		// 2. Phase B TOML injections (GATED)
		if *hilt != "" {
			tomlStr = injectTomlVersion(tomlStr, "hilt", *hilt)
			tomlStr = injectTomlPlugin(tomlStr, "hilt", "com.google.dagger.hilt.android", "hilt")
		}

		if *room != "" {
			tomlStr = injectTomlVersion(tomlStr, "room", *room)
			tomlStr = injectTomlPlugin(tomlStr, "room", "androidx.room", "room")
		}

		if *navigation != "" {
			tomlStr = injectTomlVersion(tomlStr, "navigation", *navigation)
			tomlStr = injectTomlPlugin(tomlStr, "navigation-safeargs", "androidx.navigation.safeargs.kotlin", "navigation")
		}

		// KSP (existing logic, adapted)
		if *ksp != "" {
			tomlStr = injectTomlVersion(tomlStr, "ksp", *ksp)
			tomlStr = injectTomlPlugin(tomlStr, "ksp", "com.google.devtools.ksp", "ksp")
		}

		// Compose Compiler injection (if provided)
		if *composeCompiler != "" {
			tomlStr = injectTomlVersion(tomlStr, "composeCompiler", *composeCompiler)
			tomlStr = injectTomlPlugin(tomlStr, "compose-compiler", "org.jetbrains.kotlin.plugin.compose", "composeCompiler")
		}

		if err := os.WriteFile(tomlPath, []byte(tomlStr), 0644); err != nil {
			log.Fatalf("Failed to write toml: %v", err)
		}

		// 3. App build.gradle.kts injections
		appGradleKts := filepath.Join(*dir, "app", "build.gradle.kts")
		appContent, _ := os.ReadFile(appGradleKts)
		appStr := string(appContent)

		appStr = replaceInString(appStr, `compileSdk\s*=\s*\d+`, fmt.Sprintf(`compileSdk = %s`, *compileSdk))
		appStr = injectAppPluginKts(appStr, "alias(libs.plugins.ksp)") // Existing, always present

		// Phase B App Plugin Injections (GATED)
		if *hilt != "" {
			appStr = injectAppPluginKts(appStr, "alias(libs.plugins.hilt)")
		}
		if *room != "" {
			appStr = injectAppPluginKts(appStr, "alias(libs.plugins.room)")
		}
		if *navigation != "" {
			appStr = injectAppPluginKts(appStr, "alias(libs.plugins.navigation.safeargs)")
		}

		// Dependencies (already correctly gated)
		if *hilt != "" {
			appStr = injectAppDependencyKts(appStr, fmt.Sprintf(`implementation("com.google.dagger:hilt-android:%s")`, *hilt))
			appStr = injectAppDependencyKts(appStr, fmt.Sprintf(`ksp("com.google.dagger:hilt-compiler:%s")`, *hilt))
		}
		if *room != "" {
			appStr = injectAppDependencyKts(appStr, fmt.Sprintf(`implementation("androidx.room:room-runtime:%s")`, *room))
			appStr = injectAppDependencyKts(appStr, fmt.Sprintf(`ksp("androidx.room:room-compiler:%s")`, *room))
		}
		if *navigation != "" {
			appStr = injectAppDependencyKts(appStr, fmt.Sprintf(`implementation("androidx.navigation:navigation-fragment-ktx:%s")`, *navigation))
			appStr = injectAppDependencyKts(appStr, fmt.Sprintf(`implementation("androidx.navigation:navigation-ui-ktx:%s")`, *navigation))
		}
		// Compose Compiler App KTS injection
		if *composeCompiler != "" {
			appStr = injectAppPluginKts(appStr, "alias(libs.plugins.compose.compiler)")
		}

		if err := os.WriteFile(appGradleKts, []byte(appStr), 0644); err != nil {
			log.Fatalf("Failed to update app/build.gradle.kts: %v", err)
		}

		// 4. Root build.gradle.kts injections (GATED)
		rootGradleKts := filepath.Join(*dir, "build.gradle.kts")
		rootContent, _ := os.ReadFile(rootGradleKts)
		rootStr := string(rootContent)

		if *hilt != "" {
			rootStr = injectRootPluginKts(rootStr, "alias(libs.plugins.hilt)")
		}
		if *room != "" {
			rootStr = injectRootPluginKts(rootStr, "alias(libs.plugins.room)")
		}
		if *navigation != "" {
			rootStr = injectRootPluginKts(rootStr, "alias(libs.plugins.navigation.safeargs)")
		}

		if err := os.WriteFile(rootGradleKts, []byte(rootStr), 0644); err != nil {
			log.Fatalf("Failed to update root build.gradle.kts: %v", err)
		}

		// 5. Update gradle-wrapper.properties (existing)
		wrapperPath := filepath.Join(*dir, "gradle", "wrapper", "gradle-wrapper.properties")
		if err := replaceInFile(wrapperPath, map[string]string{
			`distributionUrl=.*`: fmt.Sprintf(`distributionUrl=https\://services.gradle.org/distributions/gradle-%s-bin.zip`, *gradle),
		}); err != nil {
			log.Fatalf("Failed to update wrapper: %v", err)
		}

		fmt.Println("✅ Injection complete for AGP8/9 (Kotlin DSL with Phase B axes)")
	}
}

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

func ensureKSPPluginGroovy(filePath, kspVersion string) error {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}
	str := string(content)
	if strings.Contains(str, "com.google.devtools.ksp") {
		return nil
	}
	re := regexp.MustCompile(`(?m)^\s*id\s+'kotlin-android'[^\n]*\n`)
	if !re.MatchString(str) {
		newContent := fmt.Sprintf("plugins {\n    id 'com.google.devtools.ksp' version '%s'\n}\n\n", kspVersion) + str
		return os.WriteFile(filePath, []byte(newContent), 0644)
	}
	newContent := re.ReplaceAllString(str, "$0    id 'com.google.devtools.ksp' version '"+kspVersion+"'\n")
	return os.WriteFile(filePath, []byte(newContent), 0644)
}

func ensureKSPToml(tomlPath, kspVersion string) error {
	content, err := os.ReadFile(tomlPath)
	if err != nil {
		return err
	}
	str := string(content)
	if strings.Contains(str, "\nksp = ") {
		re := regexp.MustCompile(`(?m)^ksp\s*=\s*".*"$`)
		if re.MatchString(str) {
			newContent := re.ReplaceAllString(str, fmt.Sprintf(`ksp = "%s"`, kspVersion))
			return ensureKSPSection(newContent, tomlPath, kspVersion)
		}
	}
	reVersions := regexp.MustCompile(`(?m)^\[versions\]\n`)
	if !reVersions.MatchString(str) {
		return fmt.Errorf("[versions] section not found")
	}
	newContent := reVersions.ReplaceAllString(str, "[versions]\nksp = \""+kspVersion+"\"\n")
	return ensureKSPSection(newContent, tomlPath, kspVersion)
}

func ensureKSPSection(content string, tomlPath, kspVersion string) error {
	rePlugins := regexp.MustCompile(`(?m)^\[plugins\]\n`)
	if !rePlugins.MatchString(content) {
		content += "\n[plugins]\nksp = { id = \"com.google.devtools.ksp\", version.ref = \"ksp\" }\n"
	} else {
		if strings.Contains(content, "ksp = { id = \"com.google.devtools.ksp\"") {
			return nil
		}
		re := regexp.MustCompile(`(?m)^\[plugins\]\n`)
		content = re.ReplaceAllString(content, "[plugins]\nksp = { id = \"com.google.devtools.ksp\", version.ref = \"ksp\" }\n")
	}
	return os.WriteFile(tomlPath, []byte(content), 0644)
}

func ensureKSPPluginKts(appGradleKts string) error {
	content, err := os.ReadFile(appGradleKts)
	if err != nil {
		return err
	}
	str := string(content)
	if strings.Contains(str, "alias(libs.plugins.ksp)") {
		return nil
	}
	re := regexp.MustCompile(`(?m)^plugins\s*\{`)
	if !re.MatchString(str) {
		return fmt.Errorf("plugins block not found")
	}
	newContent := re.ReplaceAllString(str, "plugins {\n    alias(libs.plugins.ksp)")
	return os.WriteFile(appGradleKts, []byte(newContent), 0644)
}

func injectTomlVersion(content, key, version string) string {
	if version == "" {
		return content
	}
	// Strip UTF-8 BOM if present to ensure ^ matches the first line
	content = strings.TrimPrefix(content, "\xef\xbb\xbf")

	// Match [versions] with optional trailing whitespace and any newline style (\n or \r\n)
	re := regexp.MustCompile(`(?m)^\[versions\][ \t]*\r?\n`)
	if re.MatchString(content) {
		return re.ReplaceAllString(content, fmt.Sprintf("[versions]\n%s = \"%s\"\n", key, version))
	}
	// Fallback: if [versions] header is missing or malformed, safely prepend it
	return fmt.Sprintf("[versions]\n%s = \"%s\"\n\n%s", key, version, content)
}

func injectTomlPlugin(content, alias, id, versionRef string) string {
	if versionRef == "" {
		return content
	}
	if strings.Contains(content, fmt.Sprintf("%s = { id = \"%s\"", alias, id)) {
		return content // Already exists
	}
	// Match [plugins] with optional trailing whitespace and any newline style
	re := regexp.MustCompile(`(?m)^\[plugins\][ \t]*\r?\n`)
	if re.MatchString(content) {
		return re.ReplaceAllString(content, fmt.Sprintf("[plugins]\n%s = { id = \"%s\", version.ref = \"%s\" }\n", alias, id, versionRef))
	}
	// Fallback: append to the end of the file if [plugins] isn't found cleanly
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
	return re.ReplaceAllString(content, fmt.Sprintf("dependencies {\n    %s", dependency))
}
