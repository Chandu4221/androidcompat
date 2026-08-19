package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

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

func main() {
	resultFile := flag.String("result", "", "Path to result JSON file")
	cacheFile := flag.String("cache", "docs/data/ondemand/compat.json", "Cache file path")
	flag.Parse()

	if *resultFile == "" {
		fmt.Fprintln(os.Stderr, "❌ --result is required")
		os.Exit(1)
	}

	// Load new result
	resultData, err := os.ReadFile(*resultFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to read result file: %v\n", err)
		os.Exit(1)
	}

	var newResult VerificationResult
	if err := json.Unmarshal(resultData, &newResult); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to parse result: %v\n", err)
		os.Exit(1)
	}

	// Load cache
	var cache OnDemandCache
	if data, err := os.ReadFile(*cacheFile); err == nil {
		if err := json.Unmarshal(data, &cache); err != nil {
			fmt.Fprintf(os.Stderr, "⚠️ Failed to parse cache, starting fresh: %v\n", err)
			cache = OnDemandCache{Results: []VerificationResult{}}
		}
	} else {
		fmt.Printf("ℹ️ Cache file not found, creating new\n")
		cache = OnDemandCache{Results: []VerificationResult{}}
	}

	// Append new result
	cache.Results = append(cache.Results, newResult)

	// Ensure directory exists
	if err := os.MkdirAll("docs/data/ondemand", 0755); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to create directory: %v\n", err)
		os.Exit(1)
	}

	// Write back
	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to marshal cache: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(*cacheFile, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to write cache: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ Appended result to cache. Total results: %d\n", len(cache.Results))
}
