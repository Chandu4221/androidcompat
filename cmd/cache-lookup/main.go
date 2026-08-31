package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/Chandu4221/androidcompat/internal/storage"
)

// LibCoord matches the incoming request format from the workflow
type LibCoord struct {
	Group    string `json:"group"`
	Artifact string `json:"artifact"`
	Version  string `json:"version"`
}

type OnDemandCache struct {
	Results []storage.VerificationResult `json:"results"`
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

	// Build canonical library keys (group:artifact:version) for hashing.
	// Format MUST match what collect passes to storage.ComboID():
	// collect builds Library.Name = "group:artifact" then LibraryKeys
	// appends ":version" → "group:artifact:version". Same result here.
	libKeys := make([]string, len(libs))
	for i, lib := range libs {
		libKeys[i] = fmt.Sprintf("%s:%s:%s", lib.Group, lib.Artifact, lib.Version)
	}

	// Compute the expected combo ID from the hash.
	// This is the SINGLE SOURCE OF TRUTH — the same function collect used
	// when it wrote the result, and cache-append uses for dedup.
	expectedID := storage.ComboID(*foundationID, libKeys)

	// Load cache
	var cache OnDemandCache
	if data, err := os.ReadFile(*cacheFile); err == nil {
		if err := json.Unmarshal(data, &cache); err != nil {
			fmt.Fprintf(os.Stderr, "⚠️ Failed to parse cache, treating as empty: %v\n", err)
		}
	}

	// Search for matching result by exact ID match.
	// The ID already encodes the library set, so equality here means
	// "same foundation + same libraries regardless of order" — no set logic needed.
	for _, result := range cache.Results {
		if result.ID == expectedID {
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
			os.Exit(0)
		}
	}

	fmt.Printf("ℹ️ No cache hit for foundation %s with %d addons (expected combo ID: %s)\n", *foundationID, len(libs), expectedID)
	os.Exit(1)
}
