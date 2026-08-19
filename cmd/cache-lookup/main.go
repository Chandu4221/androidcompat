package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
)

type LibCoord struct {
	Group    string `json:"group"`
	Artifact string `json:"artifact"`
	Version  string `json:"version"`
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
	Libraries []struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	} `json:"libraries"`
	Status           string `json:"status"`
	FailureSignature string `json:"failureSignature,omitempty"`
	ErrorMessage     string `json:"errorMessage,omitempty"`
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

func generateComboKey(foundationID string, libs []LibCoord) string {
	// Sort addons for deterministic key
	sort.Slice(libs, func(i, j int) bool {
		ci := fmt.Sprintf("%s:%s:%s", libs[i].Group, libs[i].Artifact, libs[i].Version)
		cj := fmt.Sprintf("%s:%s:%s", libs[j].Group, libs[j].Artifact, libs[j].Version)
		return ci < cj
	})

	parts := []string{foundationID}
	for _, lib := range libs {
		parts = append(parts, fmt.Sprintf("%s:%s:%s", lib.Group, lib.Artifact, lib.Version))
	}

	raw := strings.Join(parts, "|")
	hash := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(hash[:])[:16]
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

	comboKey := generateComboKey(*foundationID, libs)

	// Load cache
	var cache OnDemandCache
	if data, err := os.ReadFile(*cacheFile); err == nil {
		if err := json.Unmarshal(data, &cache); err != nil {
			fmt.Fprintf(os.Stderr, "⚠️ Failed to parse cache, treating as empty: %v\n", err)
			cache = OnDemandCache{Results: []VerificationResult{}}
		}
	} else {
		fmt.Printf("ℹ️ Cache file not found, treating as empty\n")
	}

	// Search for matching result
	// Search for matching result
	for _, result := range cache.Results {
		// Check if Foundation ID and libraries match
		if len(result.Libraries) == len(libs) && strings.HasPrefix(result.ID, *foundationID) {
			match := true
			for i, lib := range libs {
				expected := fmt.Sprintf("%s:%s", lib.Group, lib.Artifact)
				if result.Libraries[i].Name != expected || result.Libraries[i].Version != lib.Version {
					match = false
					break
				}
			}
			if match {
				// Found! Output the cached result
				data, _ := json.MarshalIndent(result, "", "  ")
				fmt.Println(string(data))
				os.Exit(0)
			}
		}
	}
	// Not found
	fmt.Printf("CACHE_KEY=%s\n", comboKey)
	os.Exit(1)
}
