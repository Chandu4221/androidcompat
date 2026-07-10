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
	result.Verification.UnitTest = "NO_TESTS_ADDED"

	// Extract the error block (What went wrong / Caused by)
	errorBlock := extractErrorBlock(output)
	if errorBlock == "" {
		// If no error block, fall back to scanning the whole log
		errorBlock = output
	}

	failed := false

	// 1. Check for specific, high‑confidence signatures FIRST
	if strings.Contains(output, "BUILD SUCCESSFUL") {
		result.Verification.Sync = "PASSED"
		result.Verification.Compile = "PASSED"
		result.Verification.UnitTest = "NO_TESTS_ADDED"
		result.Status = "verified"
		return result
	}

	// 2. Sync failures (dependency resolution)
	if strings.Contains(errorBlock, "Could not resolve all dependencies") ||
		strings.Contains(errorBlock, "Could not find") {
		result.Verification.Sync = "FAILED"
		failed = true
		result.FailureSignature = "dependency_resolution_failure"
	}

	// 3. Compile failures (compileSdk, Kotlin, Java)
	if !failed {
		if strings.Contains(errorBlock, "compileSdk") ||
			strings.Contains(errorBlock, "failed to load include path") ||
			strings.Contains(errorBlock, "android.jar") {
			failed = true
			result.Verification.Compile = "FAILED"
			result.FailureSignature = "compile_sdk_mismatch"
		} else if strings.Contains(errorBlock, "KotlinCompile") || strings.Contains(errorBlock, "kotlin") {
			failed = true
			result.Verification.Compile = "FAILED"
			result.FailureSignature = "kotlin_compilation_failure"
		} else if strings.Contains(errorBlock, "Compilation failed") ||
			strings.Contains(errorBlock, "cannot find symbol") ||
			strings.Contains(errorBlock, "Unresolved reference") {
			failed = true
			result.Verification.Compile = "FAILED"
			if strings.Contains(errorBlock, "Unresolved reference") {
				result.FailureSignature = "unresolved_reference"
			} else if strings.Contains(errorBlock, "cannot find symbol") {
				result.FailureSignature = "cannot_find_symbol"
			} else {
				result.FailureSignature = "compilation_failure"
			}
		}
	}

	// 4. If still not classified, try other known patterns (in order of specificity)
	if !failed {
		if strings.Contains(errorBlock, "Using kotlin.sourceSets DSL to add Kotlin sources is not allowed with built-in Kotlin") {
			failed = true
			result.FailureSignature = "built_in_kotlin_sourceset_conflict"
		} else if strings.Contains(errorBlock, "dagger") && strings.Contains(errorBlock, "metadata") {
			failed = true
			result.FailureSignature = "dagger_metadata_error"
		} else if strings.Contains(errorBlock, "KSP") && strings.Contains(errorBlock, "version") {
			failed = true
			result.FailureSignature = "ksp_version_mismatch"
		} else if strings.Contains(errorBlock, "Compose") && strings.Contains(errorBlock, "compiler") {
			failed = true
			result.FailureSignature = "compose_compiler_mismatch"
		} else if strings.Contains(errorBlock, "Could not find or load main class") {
			failed = true
			result.FailureSignature = "class_not_found"
		}
	}

	// 5. Generic fallback
	if !failed && strings.Contains(errorBlock, "FAILURE") {
		failed = true
		result.FailureSignature = "build_failure"
	}

	// Extract error message
	if failed {
		lines := strings.Split(output, "\n")
		for _, line := range lines {
			if strings.Contains(line, "What went wrong:") && len(line) > 20 {
				result.ErrorMessage = strings.TrimSpace(strings.TrimPrefix(line, "What went wrong:"))
				break
			}
		}
		if result.ErrorMessage == "" {
			for _, line := range lines {
				if strings.Contains(strings.ToLower(line), "error:") || strings.Contains(strings.ToLower(line), "failed:") {
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

// extractErrorBlock attempts to find the "What went wrong" or "Caused by" section.
func extractErrorBlock(output string) string {
	lines := strings.Split(output, "\n")
	var block []string
	inError := false
	for _, line := range lines {
		if strings.Contains(line, "What went wrong:") || strings.Contains(line, "Caused by:") {
			inError = true
		}
		if inError {
			block = append(block, line)
			// Stop at a blank line or after a certain number of lines
			if strings.TrimSpace(line) == "" && len(block) > 5 {
				break
			}
			if len(block) > 30 {
				break
			}
		}
	}
	if len(block) == 0 {
		return output
	}
	return strings.Join(block, "\n")
}
