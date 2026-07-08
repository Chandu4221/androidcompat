package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// LoadCompat reads compat.json for a specific AGP major
func LoadCompat(major int) (*CompatFile, error) {
	dir := GetAgpDir(major)
	path := filepath.Join(dir, "compat.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &CompatFile{
				AGPMajor: major,
				Results:  []VerificationResult{},
			}, nil
		}
		return nil, fmt.Errorf("failed to read %s: %w", path, err)
	}

	var compat CompatFile
	if err := json.Unmarshal(data, &compat); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", path, err)
	}

	return &compat, nil
}

// SaveCompat writes compat.json for a specific AGP major
func SaveCompat(major int, compat *CompatFile) error {
	dir := GetAgpDir(major)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	path := filepath.Join(dir, "compat.json")
	data, err := json.MarshalIndent(compat, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal compat: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", path, err)
	}

	return nil
}

// GetVerifiedComboIDs returns a set of combo IDs that are already verified
// (status == "verified") for a given AGP major
func GetVerifiedComboIDs(major int) (map[string]bool, error) {
	compat, err := LoadCompat(major)
	if err != nil {
		return nil, err
	}

	verified := make(map[string]bool)
	for _, result := range compat.Results {
		if result.Status == "verified" {
			verified[result.ID] = true
		}
	}
	return verified, nil
}
