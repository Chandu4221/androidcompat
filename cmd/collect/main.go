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
	// Default statuses
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

	// -------- EARLY SUCCESS DETECTION --------
	if strings.Contains(output, "BUILD SUCCESSFUL") {
		result.Verification.Sync = "PASSED"
		result.Verification.Compile = "PASSED"
		result.Verification.UnitTest = "NO_TESTS_ADDED"
		result.Status = "verified"
		return result
	}

	// -------- PHASE DETECTION (structural, not phrase-based) --------
	configPhaseFailed := strings.Contains(errorBlock, "A problem occurred configuring")
	executionPhaseFailed := strings.Contains(errorBlock, "Execution failed for task")

	// Set sync/compile status based on phase
	if configPhaseFailed {
		result.Verification.Sync = "FAILED"
		failed = true
	} else {
		result.Verification.Sync = "PASSED"
	}

	if executionPhaseFailed {
		result.Verification.Compile = "FAILED"
		failed = true
	} else if !configPhaseFailed && !executionPhaseFailed {
		// No clear phase marker but we know build failed (since BUILD SUCCESSFUL was absent)
		// Leave compile status as SKIPPED if not already set; we'll still mark failed.
		// We'll treat it as a generic failure.
		failed = true
	}

	// -------- SUB-CLASSIFY within the detected phase --------
	if configPhaseFailed {
		// Sync-phase failure: distinguish network/infra from real resolution issues
		if matched, _ := regexp.MatchString(`Received status code \d{3}`, errorBlock); matched {
			result.FailureSignature = "dependency_fetch_error"
		} else {
			result.FailureSignature = "dependency_resolution_failure"
		}
	} else if executionPhaseFailed {
		// Compile-phase failure: use specific patterns
		if strings.Contains(errorBlock, "KotlinCompile") || strings.Contains(errorBlock, "e: ") {
			result.FailureSignature = "kotlin_compilation_failure"
		} else if strings.Contains(errorBlock, "compileSdk") || strings.Contains(errorBlock, "android.jar") {
			result.FailureSignature = "compile_sdk_mismatch"
		} else if strings.Contains(errorBlock, "dagger") && strings.Contains(errorBlock, "metadata") {
			result.FailureSignature = "dagger_metadata_error"
		} else if strings.Contains(errorBlock, "KSP") && strings.Contains(errorBlock, "version") {
			result.FailureSignature = "ksp_version_mismatch"
		} else if strings.Contains(errorBlock, "Compose") && strings.Contains(errorBlock, "compiler") {
			result.FailureSignature = "compose_compiler_mismatch"
		} else {
			result.FailureSignature = "build_failure"
		}
	} else {
		// No phase marker (should be rare) – fallback to generic failure
		result.FailureSignature = "build_failure"
	}

	// -------- EXTRACT ERROR MESSAGE (keep existing logic) --------
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

// extractErrorBlock captures everything from "What went wrong" / "Caused by" until the build failure summary.
func extractErrorBlock(output string) string {
	lines := strings.Split(output, "\n")
	var block []string
	inError := false
	for _, line := range lines {
		if strings.Contains(line, "What went wrong:") || strings.Contains(line, "Caused by:") {
			inError = true
		}
		if inError {
			// Stop when we hit the end of the error report
			if strings.Contains(line, "BUILD FAILED") ||
				strings.Contains(line, "FAILURE: Build failed") ||
				strings.Contains(line, "* Try:") ||
				strings.Contains(line, "* Get more help at") {
				break
			}
			block = append(block, line)
		}
	}
	if len(block) == 0 {
		return output
	}
	return strings.Join(block, "\n")
}
