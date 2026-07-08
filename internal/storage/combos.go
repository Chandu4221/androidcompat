package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// GetAgpDir returns the data directory for a given AGP major version
func GetAgpDir(major int) string {
	return filepath.Join("data", fmt.Sprintf("agp%d", major))
}

// LoadCombos reads combos-to-test.json for a specific AGP major
func LoadCombos(major int) (*CombosFile, error) {
	dir := GetAgpDir(major)
	path := filepath.Join(dir, "combos-to-test.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &CombosFile{
				AGPMajor:    major,
				GeneratedAt: "",
				Combos:      []Combo{},
			}, nil
		}
		return nil, fmt.Errorf("failed to read %s: %w", path, err)
	}

	var combos CombosFile
	if err := json.Unmarshal(data, &combos); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", path, err)
	}

	return &combos, nil
}

// SaveCombos writes combos-to-test.json for a specific AGP major
func SaveCombos(major int, combos *CombosFile) error {
	dir := GetAgpDir(major)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	path := filepath.Join(dir, "combos-to-test.json")
	data, err := json.MarshalIndent(combos, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal combos: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", path, err)
	}

	return nil
}
