package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	SharedDir = "data/shared"
)

// LoadVersionRegistry reads version-registry.json from data/shared/
func LoadVersionRegistry() (*VersionRegistry, error) {
	path := filepath.Join(SharedDir, "version-registry.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("version-registry.json not found at %s: %w", path, err)
		}
		return nil, fmt.Errorf("failed to read %s: %w", path, err)
	}

	var reg VersionRegistry
	if err := json.Unmarshal(data, &reg); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", path, err)
	}

	return &reg, nil
}
