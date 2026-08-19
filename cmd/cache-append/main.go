package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
)

// CachedLibrary matches the format saved by cmd/collect
type CachedLibrary struct {
	Name    string `json:"name"` // stored as "group:artifact"
	Version string `json:"version"`
}

type VerificationResult struct {
	ID            string `json:"id"`
	Timestamp     string `json:"timestamp"`
	WorkflowURL   string `json:"workflowUrl,omitempty"`
	CoreToolchain struct {
		AGP        string `json:"agp"`
		Gradle     string `json:"gradle"`
		Kotlin     string `json:"kotlin"`
		KSP        string `json:"ksp"`
		JDK        string `json:"jdk"`
		CompileSdk string `json:"compileSdk"`
		SdkPackage string `json:"sdkPackage"`
	} `json:"coreToolchain"`
	Libraries        []CachedLibrary `json:"libraries"`
	Status           string          `json:"status"`
	FailureSignature string          `json:"failureSignature,omitempty"`
	ErrorMessage     string          `json:"errorMessage,omitempty"`
	Verification     struct {
		Sync     string `json:"sync"`
		Compile  string `json:"compile"`
		UnitTest string `json:"unit_test"`
	} `json:"verification"`
	BuildLog string `json:"buildLog,omitempty"`
}

type OnDemandCache struct {
	Results []VerificationResult `json:"results"`
}

// comboKey produces an order-independent canonical key for a result:
// result ID + sorted "name:version" library list.
// Used to detect duplicates regardless of library order.
func comboKey(r VerificationResult) string {
	keys := make([]string, len(r.Libraries))
	for i, lib := range r.Libraries {
		keys[i] = lib.Name + ":" + lib.Version
	}
	sort.Strings(keys)
	return r.ID + "|" + strings.Join(keys, ",")
}

func main() {
	resultFile := flag.String("result", "", "Path to result JSON file (from cmd/collect)")
	cacheFile := flag.String("cache", "docs/data/ondemand/compat.json", "Cache file path")
	flag.Parse()

	if *resultFile == "" {
		fmt.Fprintln(os.Stderr, "❌ --result is required")
		os.Exit(1)
	}

	// 1. Read the new result
	resultData, err := os.ReadFile(*resultFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to read result file: %v\n", err)
		os.Exit(1)
	}

	var newResult VerificationResult
	if err := json.Unmarshal(resultData, &newResult); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to parse result JSON: %v\n", err)
		os.Exit(1)
	}

	// 2. Strip heavy buildLog to keep cache file lean for the UI
	newResult.BuildLog = ""

	// 3. Load existing cache (or create empty)
	var cache OnDemandCache
	if data, err := os.ReadFile(*cacheFile); err == nil {
		if err := json.Unmarshal(data, &cache); err != nil {
			fmt.Fprintf(os.Stderr, "⚠️ Failed to parse existing cache, starting fresh: %v\n", err)
			cache = OnDemandCache{Results: []VerificationResult{}}
		}
	} else {
		fmt.Printf("ℹ️ Cache file not found, creating new\n")
		cache = OnDemandCache{Results: []VerificationResult{}}
	}

	// 4. Idempotent append: replace if same combo key exists, otherwise append
	newKey := comboKey(newResult)
	replaced := false
	for i, existing := range cache.Results {
		if comboKey(existing) == newKey {
			cache.Results[i] = newResult
			replaced = true
			break
		}
	}
	if replaced {
		fmt.Printf("♻️  Replaced existing entry for combo %s\n", newResult.ID)
	} else {
		cache.Results = append(cache.Results, newResult)
		fmt.Printf("✅ Appended new result. Total cached results: %d\n", len(cache.Results))
	}

	// 5. Ensure output directory exists
	dir := *cacheFile
	if idx := strings.LastIndex(dir, "/"); idx > 0 {
		dir = dir[:idx]
		if err := os.MkdirAll(dir, 0755); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Failed to create cache directory: %v\n", err)
			os.Exit(1)
		}
	}

	// 6. Write updated cache
	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to marshal cache: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(*cacheFile, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to write cache file: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ Cache written to %s\n", *cacheFile)
}
