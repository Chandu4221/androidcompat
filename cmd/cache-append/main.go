package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/Chandu4221/androidcompat/internal/storage"
)

type OnDemandCache struct {
	Results []storage.VerificationResult `json:"results"`
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

	var newResult storage.VerificationResult
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
			cache = OnDemandCache{Results: []storage.VerificationResult{}}
		}
	} else {
		fmt.Printf("ℹ️ Cache file not found, creating new\n")
		cache = OnDemandCache{Results: []storage.VerificationResult{}}
	}

	// 4. Idempotent append: the combo ID is a hash of (foundation + sorted libs),
	//    so ID equality means "same combo regardless of library order".
	replaced := false
	for i, existing := range cache.Results {
		if existing.ID == newResult.ID {
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
