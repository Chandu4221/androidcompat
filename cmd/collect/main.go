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

// structuredError holds the data from the Gradle init script.
type structuredError struct {
	Task      string `json:"task"`
	ErrorType string `json:"errorType"`
	Cause     string `json:"cause"`
}

// parseStructuredError scans the build output for the classification marker
// and returns the first valid structured error found.
func parseStructuredError(output string) (structuredError, bool) {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "[[ERROR_CLASSIFICATION]]") {
			// Extract the JSON part after the marker
			idx := strings.Index(line, "[[ERROR_CLASSIFICATION]]")
			jsonPart := line[idx+len("[[ERROR_CLASSIFICATION]]"):]
			var se structuredError
			if err := json.Unmarshal([]byte(jsonPart), &se); err == nil {
				return se, true
			}
		}
	}
	return structuredError{}, false
}

// mapErrorToSignature uses the Gradle exception type (and optionally the cause)
// to return a stable failure signature.
func mapErrorToSignature(errorType, cause string) string {
	switch {
	case strings.Contains(errorType, "ResolveException"):
		if matched, _ := regexp.MatchString(`status code [45]\d\d`, cause); matched {
			return "dependency_fetch_error"
		}
		return "dependency_resolution_failure"
	case strings.Contains(errorType, "TaskExecutionException"):
		if strings.Contains(cause, "KSP") {
			return "ksp_version_mismatch"
		}
		if strings.Contains(cause, "compileSdk") || strings.Contains(cause, "requires libraries") {
			return "compile_sdk_mismatch"
		}
		if strings.Contains(cause, "Dagger") || strings.Contains(cause, "dagger") {
			return "dagger_metadata_error"
		}
		if strings.Contains(cause, "Compose") {
			return "compose_compiler_mismatch"
		}
		if strings.Contains(cause, "Kotlin") {
			return "kotlin_compilation_failure"
		}
		// If no specific match, return empty to let fallback handle it.
		return ""
	case strings.Contains(errorType, "GradleException"):
		// Generic GradleException – fall back to prose.
		return ""
	default:
		return ""
	}
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

	// Extract the error block (fallback for prose scanning)
	errorBlock := extractErrorBlock(output)
	if errorBlock == "" {
		errorBlock = output
	}

	failed := false

	// EARLY SUCCESS DETECTION
	if strings.Contains(output, "BUILD SUCCESSFUL") {
		result.Verification.Sync = "PASSED"
		result.Verification.Compile = "PASSED"
		result.Verification.UnitTest = "NO_TESTS_ADDED"
		result.Status = "verified"
		return result
	}

	// Try to get structured error from Gradle init script
	se, hasStructured := parseStructuredError(output)

	// Determine phase and signature
	configPhaseFailed := false
	executionPhaseFailed := false

	if hasStructured {
		// Use structured data for phase detection
		if se.Task != "N/A" {
			executionPhaseFailed = true
		} else {
			configPhaseFailed = true
		}

		// Map errorType to signature
		sig := mapErrorToSignature(se.ErrorType, se.Cause)
		if sig != "" {
			result.FailureSignature = sig
		}
		// If sig is empty, we'll fall back to prose-based detection below.

		// Set status flags based on phase
		if configPhaseFailed {
			result.Verification.Sync = "FAILED"
			failed = true
		}
		if executionPhaseFailed {
			result.Verification.Compile = "FAILED"
			failed = true
		}
	} else {
		// No structured data – fallback to old prose‑based phase detection
		configPhaseFailed = strings.Contains(errorBlock, "A problem occurred configuring")
		executionPhaseFailed = strings.Contains(errorBlock, "Execution failed for task")

		if configPhaseFailed {
			result.Verification.Sync = "FAILED"
			failed = true
		}
		if executionPhaseFailed {
			result.Verification.Compile = "FAILED"
			failed = true
		}
	}

	// If we haven't yet set a signature, try to derive one from the phase and error block
	if result.FailureSignature == "" {
		if configPhaseFailed {
			// Sync‑phase failure: distinguish network from real
			if matched, _ := regexp.MatchString(`Received status code \d{3}`, errorBlock); matched {
				result.FailureSignature = "dependency_fetch_error"
			} else {
				result.FailureSignature = "dependency_resolution_failure"
			}
		} else if executionPhaseFailed {
			// Compile‑phase failure: use specific patterns
			if strings.Contains(errorBlock, "KotlinCompile") || strings.Contains(errorBlock, "e: ") {
				result.FailureSignature = "kotlin_compilation_failure"
			} else if strings.Contains(errorBlock, "compileSdk") || strings.Contains(errorBlock, "android.jar") ||
				strings.Contains(errorBlock, "requires libraries and applications that depend on it to compile against version") {
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
			// No phase marker – generic fallback
			result.FailureSignature = "build_failure"
		}
	}

	// Special handling: if we have structured data and the signature is dependency_fetch_error,
	// mark as inconclusive so it can be skipped later.
	if hasStructured && result.FailureSignature == "dependency_fetch_error" {
		result.Status = "inconclusive"
	} else if failed {
		result.Status = "failed"
	} else {
		// If we detected failure but didn't set status, it might be a fallback case
		if result.FailureSignature != "" {
			result.Status = "failed"
		}
	}

	// -------- FIXED ERROR MESSAGE EXTRACTION --------
	if failed || result.Status == "inconclusive" {
		lines := strings.Split(output, "\n")
		for i, line := range lines {
			if strings.Contains(line, "What went wrong:") && i+1 < len(lines) {
				// The actual message is on the NEXT line
				result.ErrorMessage = strings.TrimSpace(lines[i+1])
				break
			}
		}
		if result.ErrorMessage == "" {
			for _, line := range lines {
				if strings.Contains(strings.ToLower(line), "error:") ||
					strings.Contains(strings.ToLower(line), "failed:") ||
					strings.Contains(strings.ToLower(line), "exception:") {
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

	// Write the result file (always, so artifact upload succeeds)
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
