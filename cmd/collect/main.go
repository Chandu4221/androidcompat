package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Chandu4221/androidcompat/internal/storage"
)

func main() {
	// Flags
	comboID := flag.String("id", "", "Combo ID (e.g., agp9.0.0_gradle9.1.0_kotlin2.2.0)")
	agp := flag.String("agp", "", "AGP version")
	gradle := flag.String("gradle", "", "Gradle version")
	kotlin := flag.String("kotlin", "", "Kotlin version")
	ksp := flag.String("ksp", "", "KSP version")
	jdk := flag.String("jdk", "", "JDK version")
	compileSdk := flag.String("compile-sdk", "", "compileSdk version used in build.gradle")
	sdkPackage := flag.String("sdk-package", "", "SDK platform package used in sdkmanager")
	buildDir := flag.String("dir", "", "Build directory (contains build output)")
	outputDir := flag.String("out", ".", "Output directory for result JSON")
	flag.Parse()

	if *comboID == "" || *buildDir == "" {
		log.Fatal("--id and --dir are required")
	}

	fmt.Printf("📊 Collecting result for combo: %s\n", *comboID)

	// Read stdout and stderr from the build directory
	stdoutPath := filepath.Join(*buildDir, "stdout.log")
	stderrPath := filepath.Join(*buildDir, "stderr.log")

	stdout, _ := os.ReadFile(stdoutPath)
	stderr, _ := os.ReadFile(stderrPath)

	combined := string(stdout) + "\n" + string(stderr)

	// Parse the result
	result := parseResult(*comboID, combined)

	// Populate the version fields from flags
	result.AGP = *agp
	result.Gradle = *gradle
	result.Kotlin = *kotlin
	result.KSP = *ksp
	result.JDK = *jdk
	result.CompileSdk = *compileSdk
	result.SdkPackage = *sdkPackage

	// Write the result file
	outPath := filepath.Join(*outputDir, "result-"+*comboID+".json")
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		log.Fatalf("Failed to marshal result: %v", err)
	}
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		log.Fatalf("Failed to write result: %v", err)
	}

	fmt.Printf("✅ Result saved to %s\n", outPath)
	fmt.Printf("   Status: %s\n", result.Status)
	fmt.Printf("   Sync: %s\n", result.Verification.Sync)
	fmt.Printf("   Compile: %s\n", result.Verification.Compile)
	fmt.Printf("   UnitTest: %s\n", result.Verification.UnitTest)
	fmt.Printf("   CompileSdk: %s\n", result.CompileSdk)
	fmt.Printf("   SdkPackage: %s\n", result.SdkPackage)
}

func parseResult(comboID, output string) storage.VerificationResult {
	result := storage.VerificationResult{
		ID:        comboID,
		Status:    "failed",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		BuildLog:  output,
	}
	result.Verification.Sync = "PASSED"
	result.Verification.Compile = "SKIPPED"
	result.Verification.UnitTest = "SKIPPED"

	// Check for build failure
	failed := false

	// Check for sync failure
	if strings.Contains(output, "FAILURE: Build failed with an exception.") &&
		strings.Contains(output, "Could not resolve all dependencies") {
		result.Verification.Sync = "FAILED"
		failed = true
		result.FailureSignature = "dependency_resolution_failure"
	} else if strings.Contains(output, "BUILD SUCCESSFUL") {
		// Build succeeded fully
		result.Verification.Sync = "PASSED"
		result.Verification.Compile = "PASSED"
		result.Verification.UnitTest = "PASSED"
		result.Status = "verified"
		return result
	} else if strings.Contains(output, "Compilation failed") {
		result.Verification.Compile = "FAILED"
		failed = true
		result.FailureSignature = "compilation_failure"
	} else if strings.Contains(output, "KotlinCompile") && strings.Contains(output, "FAILED") {
		result.Verification.Compile = "FAILED"
		failed = true
		result.FailureSignature = "kotlin_compilation_failure"
	} else if strings.Contains(output, "FAILURE: Build failed") {
		// Generic build failure
		failed = true
		result.FailureSignature = "build_failure"
	}

	// Try to extract a more specific failure signature
	if failed {
		if strings.Contains(output, "Using kotlin.sourceSets DSL to add Kotlin sources is not allowed with built-in Kotlin") {
			result.FailureSignature = "built_in_kotlin_sourceset_conflict"
		} else if strings.Contains(output, "dagger_metadata_error") || strings.Contains(output, "dagger") {
			result.FailureSignature = "dagger_metadata_error"
		} else if strings.Contains(output, "ksp_version_mismatch") || strings.Contains(output, "KSP") {
			result.FailureSignature = "ksp_version_mismatch"
		} else if strings.Contains(output, "compose_compiler_mismatch") || strings.Contains(output, "Compose") {
			result.FailureSignature = "compose_compiler_mismatch"
		} else if strings.Contains(output, "agp_gradle_incompatibility") || strings.Contains(output, "Gradle") {
			result.FailureSignature = "agp_gradle_incompatibility"
		} else if strings.Contains(output, "Unresolved reference") {
			result.FailureSignature = "unresolved_reference"
		} else if strings.Contains(output, "cannot find symbol") {
			result.FailureSignature = "cannot_find_symbol"
		} else if strings.Contains(output, "Could not find or load main class") {
			result.FailureSignature = "class_not_found"
		} else {
			result.FailureSignature = "unknown_failure"
		}

		// Extract a meaningful error message
		lines := strings.Split(output, "\n")
		for _, line := range lines {
			if strings.Contains(line, "What went wrong:") && len(line) > 20 {
				result.ErrorMessage = strings.TrimSpace(strings.TrimPrefix(line, "What went wrong:"))
				break
			}
		}
		if result.ErrorMessage == "" {
			for _, line := range lines {
				lower := strings.ToLower(line)
				if strings.Contains(lower, "error:") || strings.Contains(lower, "failed:") {
					result.ErrorMessage = strings.TrimSpace(line)
					break
				}
			}
		}
		if len(result.ErrorMessage) > 500 {
			result.ErrorMessage = result.ErrorMessage[:500] + "..."
		}
	}

	return result
}
