package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/Chandu4221/androidcompat/internal/storage"
)

func main() {
	agpMajor := flag.Int("agp", 0, "AGP major version (e.g., 9)")
	resultsDir := flag.String("results-dir", "results/", "Directory containing result artifacts")
	outputFile := flag.String("output", "", "Output compat.json path (default: docs/data/agpN/compat.json)")
	flag.Parse()

	if *agpMajor == 0 {
		log.Fatal("--agp is required")
	}

	// Determine output path if not specified
	output := *outputFile
	if output == "" {
		output = filepath.Join("docs", "data", fmt.Sprintf("agp%d", *agpMajor), "compat.json")
	}

	fmt.Printf("🔍 Aggregating results for AGP %d.x\n", *agpMajor)
	fmt.Printf("📁 Results directory: %s\n", *resultsDir)
	fmt.Printf("📄 Output file: %s\n", output)

	// 1. Load existing compat.json from output path (if it exists)
	var existing storage.CompatFile
	if data, err := os.ReadFile(output); err == nil {
		if err := json.Unmarshal(data, &existing); err != nil {
			log.Printf("⚠️  Failed to parse existing compat.json, starting fresh: %v", err)
			existing = storage.CompatFile{AGPMajor: *agpMajor, Results: []storage.VerificationResult{}}
		}
	} else {
		log.Printf("⚠️  No existing compat.json found, starting fresh")
		existing = storage.CompatFile{AGPMajor: *agpMajor, Results: []storage.VerificationResult{}}
	}

	// Build map of existing results by ID
	existingMap := make(map[string]storage.VerificationResult)
	for _, r := range existing.Results {
		existingMap[r.ID] = r
	}

	// 2. Walk the results directory and collect all result files
	var resultFiles []string
	err := filepath.Walk(*resultsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".json") {
			resultFiles = append(resultFiles, path)
		}
		return nil
	})
	if err != nil {
		log.Fatalf("❌ Failed to walk results directory: %v", err)
	}

	if len(resultFiles) == 0 {
		log.Println("⚠️  No result files found. Nothing to merge.")
		os.Exit(0)
	}

	fmt.Printf("📦 Found %d result files\n", len(resultFiles))

	// 3. Read each result file and update the map
	mergedCount := 0
	for _, path := range resultFiles {
		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("⚠️  Failed to read %s: %v", path, err)
			continue
		}
		var result storage.VerificationResult
		if err := json.Unmarshal(data, &result); err != nil {
			log.Printf("⚠️  Failed to parse %s: %v", path, err)
			continue
		}
		// Overwrite or add
		existingMap[result.ID] = result
		mergedCount++
	}

	// 4. Convert map back to slice
	var mergedResults []storage.VerificationResult
	for _, r := range existingMap {
		mergedResults = append(mergedResults, r)
	}

	// 5. Write the merged results to the output file
	existing.Results = mergedResults
	existing.AGPMajor = *agpMajor

	// Ensure output directory exists
	outDir := filepath.Dir(output)
	if err := os.MkdirAll(outDir, 0755); err != nil {
		log.Fatalf("❌ Failed to create output directory: %v", err)
	}

	data, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		log.Fatalf("❌ Failed to marshal compat.json: %v", err)
	}
	if err := os.WriteFile(output, data, 0644); err != nil {
		log.Fatalf("❌ Failed to write compat.json: %v", err)
	}

	fmt.Printf("✅ Merged %d new results into %s\n", mergedCount, output)
	fmt.Printf("📊 Total results: %d\n", len(existing.Results))

	// Print a quick summary
	verified := 0
	failed := 0
	for _, r := range existing.Results {
		if r.Status == "verified" {
			verified++
		} else {
			failed++
		}
	}
	fmt.Printf("   Verified: %d\n", verified)
	fmt.Printf("   Failed: %d\n", failed)
}
