package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

// LibCoord matches the incoming request format from the workflow
type LibCoord struct {
	Group    string `json:"group"`
	Artifact string `json:"artifact"`
	Version  string `json:"version"`
}

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

// buildRequestSet creates a set of "group:artifact:version" from the incoming request
func buildRequestSet(libs []LibCoord) map[string]bool {
	set := make(map[string]bool)
	for _, lib := range libs {
		key := fmt.Sprintf("%s:%s:%s", lib.Group, lib.Artifact, lib.Version)
		set[key] = true
	}
	return set
}

// buildCachedSet creates a set of "group:artifact:version" from the cached result
func buildCachedSet(libs []CachedLibrary) map[string]bool {
	set := make(map[string]bool)
	for _, lib := range libs {
		// lib.Name is already "group:artifact"
		key := fmt.Sprintf("%s:%s", lib.Name, lib.Version)
		set[key] = true
	}
	return set
}

// setsEqual checks if two string sets are identical (order-independent)
func setsEqual(a, b map[string]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if !b[k] {
			return false
		}
	}
	return true
}

func main() {
	foundationID := flag.String("foundation", "", "Foundation ID")
	libsFlag := flag.String("libs", "", "JSON array of libraries")
	cacheFile := flag.String("cache", "docs/data/ondemand/compat.json", "Cache file path")
	flag.Parse()

	if *foundationID == "" || *libsFlag == "" {
		fmt.Fprintln(os.Stderr, "❌ --foundation and --libs are required")
		os.Exit(1)
	}

	var libs []LibCoord
	if err := json.Unmarshal([]byte(*libsFlag), &libs); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Invalid --libs JSON: %v\n", err)
		os.Exit(1)
	}

	requestSet := buildRequestSet(libs)

	// Load cache
	var cache OnDemandCache
	if data, err := os.ReadFile(*cacheFile); err == nil {
		if err := json.Unmarshal(data, &cache); err != nil {
			fmt.Fprintf(os.Stderr, "⚠️ Failed to parse cache, treating as empty: %v\n", err)
		}
	}

	// Search for matching result using SET comparison (order-independent)
	expectedID := *foundationID + "-ondemand"
	for _, result := range cache.Results {
		// 1. Same Foundation? (exact match on ID, not prefix)
		if result.ID != expectedID {
			continue
		}
		// 2. Same set of libraries, regardless of order?
		cachedSet := buildCachedSet(result.Libraries)
		if setsEqual(requestSet, cachedSet) {
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
			os.Exit(0)
		}
	}

	fmt.Printf("ℹ️ No cache hit for foundation %s with %d addons\n", *foundationID, len(libs))
	os.Exit(1)
}
