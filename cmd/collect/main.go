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
	coreKtx := flag.String("core-ktx", "", "Core KTX version")
	compileSdk := flag.String("compile-sdk", "", "compileSdk version")
	sdkPackage := flag.String("sdk-package", "", "SDK platform package")
	workflowURL := flag.String("workflow-url", "", "GitHub Actions workflow run URL")

	hilt := flag.String("hilt", "", "Hilt version (optional)")
	room := flag.String("room", "", "Room version (optional)")
	navigation := flag.String("navigation", "", "Navigation version (optional)")
	compose := flag.String("compose", "", "Compose version (optional)")

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
		fmt.Println("ℹ️ No bridge JSON provided, using legacy parser")
		result = parseResult(*comboID, combined)
	}

	// Populate version fields from flags
	result.CoreToolchain.AGP = *agp
	result.CoreToolchain.Gradle = *gradle
	result.CoreToolchain.Kotlin = *kotlin
	result.CoreToolchain.KSP = *ksp
	result.CoreToolchain.JDK = *jdk
	result.CoreToolchain.CompileSdk = *compileSdk
	result.CoreToolchain.SdkPackage = *sdkPackage
	result.WorkflowURL = *workflowURL
	result.CoreToolchain.CoreKtx = *coreKtx

	result.Libraries = []storage.Library{}
	if *hilt != "" {
		result.Libraries = append(result.Libraries, storage.Library{Name: "hilt", Version: *hilt})
	}
	if *room != "" {
		result.Libraries = append(result.Libraries, storage.Library{Name: "room", Version: *room})
	}
	if *navigation != "" {
		result.Libraries = append(result.Libraries, storage.Library{Name: "navigation", Version: *navigation})
	}
	if *compose != "" {
		result.Libraries = append(result.Libraries, storage.Library{Name: "compose", Version: *compose})
	}

	result.ID = *comboID
	result.Timestamp = time.Now().UTC().Format(time.RFC3339)
	result.BuildLog = combined

	// Skip writing inconclusive results
	if result.Status == "inconclusive" {
		fmt.Printf("⚠️ Inconclusive (infra/network) — not writing result, will retry next run\n")
		return
	}

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

	// Phase detection: if task is present, it's execution phase; otherwise config phase
	if bridge.Task != nil && *bridge.Task != "" {
		result.Verification.Sync = "PASSED"
		result.Verification.Compile = "FAILED"
	} else {
		result.Verification.Sync = "FAILED"
		result.Verification.Compile = "SKIPPED"
	}

	// Extract the deepest failure
	deepest := walkFailures(bridge.Failures)
	if deepest != nil {
		result.ErrorMessage = deepest.Message
		result.FailureSignature = mapBridgeFailureToSignature(deepest)
	} else {
		result.FailureSignature = "build_failure"
	}

	// Mark infrastructure/network errors as inconclusive
	if result.FailureSignature == "dependency_fetch_error" ||
		result.FailureSignature == "infra_provisioning_error" {
		result.Status = "inconclusive"
	} else {
		result.Status = "failed"
	}

	return result, nil
}

// walkFailures returns the deepest failure in the cause chain.
func walkFailures(failures []BridgeFailure) *BridgeFailure {
	if len(failures) == 0 {
		return nil
	}
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
	// 1. Hilt/KSP Scoping Error (dagger/dagger#3965) - MUST be checked BEFORE generic KSP
	case (strings.Contains(desc, "Hilt") || strings.Contains(msg, "hilt") || strings.Contains(desc, "dagger")) &&
		(strings.Contains(desc, "KSP") || strings.Contains(msg, "ksp") || strings.Contains(desc, "class loader") || strings.Contains(desc, "sub-project")):
		return "hilt_ksp_scoping_error"

	// 2. Hilt / Gradle 8.0 Embedded Kotlin Metadata Mismatch (NEW)
	case strings.Contains(desc, "InvalidProtocolBufferException") && strings.Contains(desc, "JvmModuleProtoBuf"):
		return "hilt_gradle_embedded_kotlin_metadata_mismatch"

	// Infrastructure / provisioning errors (network, connection)
	case strings.Contains(desc, "ConnectException") ||
		strings.Contains(desc, "SocketTimeoutException") ||
		strings.Contains(desc, "UnknownHostException") ||
		strings.Contains(msg, "Could not execute build using connection to Gradle distribution"):
		return "infra_provisioning_error"

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

// ---------- Legacy Parser (fallback) ----------
// parseStructuredError scans for [[ERROR_CLASSIFICATION]] from the old init script.
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

// mapErrorToSignature (legacy)
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

// extractErrorBlock (legacy)
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

// parseResult (legacy fallback)
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

	errorBlock := extractErrorBlock(output)
	if errorBlock == "" {
		errorBlock = output
	}

	failed := false

	if strings.Contains(output, "BUILD SUCCESSFUL") {
		result.Verification.Sync = "PASSED"
		result.Verification.Compile = "PASSED"
		result.Verification.UnitTest = "NO_TESTS_ADDED"
		result.Status = "verified"
		return result
	}

	se, hasStructured := parseStructuredError(output)
	configPhaseFailed := false
	executionPhaseFailed := false

	if hasStructured {
		if se.Task != "N/A" {
			executionPhaseFailed = true
		} else {
			configPhaseFailed = true
		}
		sig := mapErrorToSignature(se.ErrorType, se.Cause)
		if sig != "" {
			result.FailureSignature = sig
		}
		if configPhaseFailed {
			result.Verification.Sync = "FAILED"
			failed = true
		}
		if executionPhaseFailed {
			result.Verification.Compile = "FAILED"
			failed = true
		}
	} else {
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

	if result.FailureSignature == "" {
		if configPhaseFailed {
			// NEW: Hilt / Gradle 8.0 Embedded Kotlin Metadata Mismatch
			if strings.Contains(errorBlock, "InvalidProtocolBufferException") && strings.Contains(errorBlock, "JvmModuleProtoBuf") {
				result.FailureSignature = "hilt_gradle_embedded_kotlin_metadata_mismatch"
			} else if matched, _ := regexp.MatchString(`Received status code \d{3}`, errorBlock); matched {
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

	if hasStructured && result.FailureSignature == "dependency_fetch_error" {
		result.Status = "inconclusive"
	} else if failed {
		result.Status = "failed"
	} else if result.FailureSignature != "" {
		result.Status = "failed"
	}

	// Error message extraction (legacy)
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
