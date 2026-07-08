package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
)

func main() {
	dir := flag.String("dir", "", "Build directory")
	agp := flag.String("agp", "", "AGP version")
	gradle := flag.String("gradle", "", "Gradle version")
	kotlin := flag.String("kotlin", "", "Kotlin version")
	ksp := flag.String("ksp", "", "KSP version")
	agpMajor := flag.Int("agp-major", 0, "AGP major version (7, 8, or 9)")
	flag.Parse()

	if *dir == "" || *agp == "" || *gradle == "" || *kotlin == "" || *ksp == "" || *agpMajor == 0 {
		log.Fatal("All flags are required: --dir, --agp, --gradle, --kotlin, --ksp, --agp-major")
	}

	// Determine which files to update based on AGP major
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

		// 2. Update app/build.gradle (Kotlin plugin version if present)
		appGradle := filepath.Join(*dir, "app", "build.gradle")
		if err := replaceInFile(appGradle, map[string]string{
			`id 'kotlin-android' version '[^']*'`: fmt.Sprintf(`id 'kotlin-android' version '%s'`, *kotlin),
		}); err != nil {
			// Not fatal if the plugin is not declared with version (might be omitted)
			log.Printf("Warning: could not update app/build.gradle: %v", err)
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
		// 1. Update libs.versions.toml
		tomlPath := filepath.Join(*dir, "gradle", "libs.versions.toml")
		if err := replaceInFile(tomlPath, map[string]string{
			`agp\s*=\s*".*"`:    fmt.Sprintf(`agp = "%s"`, *agp),
			`kotlin\s*=\s*".*"`: fmt.Sprintf(`kotlin = "%s"`, *kotlin),
		}); err != nil {
			log.Fatalf("Failed to update toml: %v", err)
		}

		// 2. Update gradle-wrapper.properties
		wrapperPath := filepath.Join(*dir, "gradle", "wrapper", "gradle-wrapper.properties")
		if err := replaceInFile(wrapperPath, map[string]string{
			`distributionUrl=.*`: fmt.Sprintf(`distributionUrl=https\://services.gradle.org/distributions/gradle-%s-bin.zip`, *gradle),
		}); err != nil {
			log.Fatalf("Failed to update wrapper: %v", err)
		}

		fmt.Println("✅ Injection complete for AGP8/9 (Kotlin DSL with toml)")
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
