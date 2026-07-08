package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// LoadRules reads rules.json from data/shared/
func LoadRules() (*Rules, error) {
	path := filepath.Join(SharedDir, "rules.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("rules.json not found at %s: %w", path, err)
		}
		return nil, fmt.Errorf("failed to read %s: %w", path, err)
	}

	var rules Rules
	if err := json.Unmarshal(data, &rules); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", path, err)
	}

	return &rules, nil
}
