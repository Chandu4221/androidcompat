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

// ---------- Bridge JSON structures ----------
type BridgeFailure struct {
	Description string          `json:"description"`
	Message     string          `json:"message"`
	Causes      []BridgeFailure `json:"causes"`
}

type BridgeResult struct {
	Status   string          `json:"status"` // "success" or "failed"
	Task     *string         `json:"task"`   // failing task path, or null
	Failures []BridgeFailure `json:"failures"`
}

// ---------- Legacy structured error (init script) ----------
type structuredError struct {
	Task      string `json:"task"`
	ErrorType string `json:"errorType"`
	Cause     string `json:"cause"`
}

// ---------- Main ----------
func main() {
	// Flags
	comboID := flag.String("id", "", "Combo ID")
	agp := flag.String("agp", "", "AGP version")
	gradle := flag.String("gradle", "", "Gradle version")
	kotlin := flag.String("kotlin", "", "Kotlin version")
	ksp := flag.String("ksp", "", "KSP version")
	jdk := flag.String("jdk", "", "JDK version")
	compileSdk := flag.String("compile-sdk", "", "compileSdk version")
	sdkPackage := flag.String("sdk-package", "", "SDK platform package")
	buildDir := flag.String("dir", "", "Build directory")
	outputDir := flag.String("out", ".", "Output directory for result JSON")
	bridgeJSON := flag.String("bridge-json", "", "Path to bridge-output.json (optional)")
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

	var result storage.VerificationResult
	var err error

	// 1. Try to parse bridge JSON if provided
	if *bridgeJSON != "" {
		result, err = parseBridgeResult(*bridgeJSON, *comboID)
		if err == nil {
			fmt.Println("✅ Using bridge classification")
		} else {
			fmt.Printf("⚠️ Bridge JSON parse failed: %v – falling back to legacy parser\n", err)
			result = parseResult(*comboID, combined)
		}
	} else {
		// No bridge JSON – use legacy parser
		fmt.Println("ℹ️ No bridge JSON provided, using legacy parser")
		result = parseResult(*comboID, combined)
	}

	// Populate version fields from flags (override bridge’s metadata)
	result.AGP = *agp
	result.Gradle = *gradle
	result.Kotlin = *kotlin
	result.KSP = *ksp
	result.JDK = *jdk
	result.CompileSdk = *compileSdk
	result.SdkPackage = *sdkPackage
	result.ID = *comboID
	result.Timestamp = time.Now().UTC().Format(time.RFC3339)
	result.BuildLog = combined

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
	fmt.Printf("   FailureSignature: %s\n", result.FailureSignature)
}

// ---------- Bridge Parser ----------
func parseBridgeResult(bridgePath, comboID string) (storage.VerificationResult, error) {
	data, err := os.ReadFile(bridgePath)
	if err != nil {
		return storage.VerificationResult{}, fmt.Errorf("failed to read bridge JSON: %w", err)
	}

	var bridge BridgeResult
	if err := json.Unmarshal(data, &bridge); err != nil {
		return storage.VerificationResult{}, fmt.Errorf("failed to parse bridge JSON: %w", err)
	}

	result := storage.VerificationResult{
		ID:        comboID,
		Status:    "failed",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	result.Verification.Sync = "PASSED"
	result.Verification.Compile = "SKIPPED"
	result.Verification.UnitTest = "NO_TESTS_ADDED"

	// If bridge status is "success", mark as verified
	if bridge.Status == "success" {
		result.Status = "verified"
		result.Verification.Sync = "PASSED"
		result.Verification.Compile = "PASSED"
		return result, nil
	}

	// Failure case
	// Determine phase: if task != nil, it's execution phase; otherwise config phase
	if bridge.Task != nil && *bridge.Task != "" {
		result.Verification.Compile = "FAILED"
	} else {
		result.Verification.Sync = "FAILED"
	}

	// Extract the deepest failure (walk the cause tree)
	deepest := walkFailures(bridge.Failures)
	if deepest != nil {
		result.ErrorMessage = deepest.Message
		result.FailureSignature = mapBridgeFailureToSignature(deepest)
	} else {
		// No failure details – generic
		result.FailureSignature = "build_failure"
	}

	// If the deepest failure is a network error, mark as inconclusive
	if strings.Contains(result.FailureSignature, "fetch_error") {
		result.Status = "inconclusive"
	} else {
		result.Status = "failed"
	}

	return result, nil
}

// walkFailures returns the deepest (last) failure in the cause chain.
func walkFailures(failures []BridgeFailure) *BridgeFailure {
	if len(failures) == 0 {
		return nil
	}
	// If there are multiple root failures, take the first one.
	deepest := &failures[0]
	for len(deepest.Causes) > 0 {
		deepest = &deepest.Causes[0]
	}
	return deepest
}

// mapBridgeFailureToSignature maps the deepest failure to a failure signature.
func mapBridgeFailureToSignature(f *BridgeFailure) string {
	desc := f.Description
	msg := f.Message

	switch {
	// KSP-related exceptions
	case strings.Contains(desc, "KSP") || strings.Contains(msg, "KSP"):
		return "ksp_version_mismatch"
	// Dagger/Hilt
	case strings.Contains(desc, "Dagger") || strings.Contains(msg, "dagger"):
		return "dagger_metadata_error"
	// Compose compiler
	case strings.Contains(desc, "Compose") || strings.Contains(msg, "Compose"):
		return "compose_compiler_mismatch"
	// Kotlin compilation
	case strings.Contains(desc, "KotlinCompile") || strings.Contains(msg, "KotlinCompile") ||
		strings.Contains(msg, "e: ") || strings.Contains(desc, "Kotlin"):
		return "kotlin_compilation_failure"
	// compileSdk issues
	case strings.Contains(msg, "compileSdk") || strings.Contains(msg, "requires libraries") ||
		strings.Contains(msg, "android.jar"):
		return "compile_sdk_mismatch"
	// Network / fetch errors (HTTP status codes)
	case regexp.MustCompile(`status code [45]\d\d`).MatchString(msg):
		return "dependency_fetch_error"
	// Gradle resolution errors
	case strings.Contains(desc, "ResolveException") || strings.Contains(msg, "Could not resolve"):
		return "dependency_resolution_failure"
	default:
		return "build_failure"
	}
}

// ---------- Legacy Parser (kept as fallback) ----------

// parseStructuredError scans the build output for the classification marker
// from the init script and returns the first valid structured error found.
func parseStructuredError(output string) (structuredError, bool) {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "[[ERROR_CLASSIFICATION]]") {
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
		return ""
	case strings.Contains(errorType, "GradleException"):
		return ""
	default:
		return ""
	}
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

// parseResult uses prose scanning and the old init script markers.
// It is now a fallback when the bridge JSON is unavailable.
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
		// No structured data – fallback to prose‑based phase detection
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
			if matched, _ := regexp.MatchString(`Received status code \d{3}`, errorBlock); matched {
				result.FailureSignature = "dependency_fetch_error"
			} else {
				result.FailureSignature = "dependency_resolution_failure"
			}
		} else if executionPhaseFailed {
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
			result.FailureSignature = "build_failure"
		}
	}

	// Special handling for dependency_fetch_error
	if hasStructured && result.FailureSignature == "dependency_fetch_error" {
		result.Status = "inconclusive"
	} else if failed {
		result.Status = "failed"
	} else if result.FailureSignature != "" {
		result.Status = "failed"
	}

	// Extract error message (prefer structured cause if available)
	if failed || result.Status == "inconclusive" {
		if hasStructured && se.Cause != "" && !strings.Contains(se.Cause, "Execution failed for task") {
			result.ErrorMessage = se.Cause
		} else {
			lines := strings.Split(output, "\n")
			for i, line := range lines {
				if strings.Contains(line, "What went wrong:") && i+1 < len(lines) {
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
		}
		if len(result.ErrorMessage) > 500 {
			result.ErrorMessage = result.ErrorMessage[:500] + "..."
		}
	}

	return result
}
