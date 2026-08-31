package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
)

// ComboID computes a unique, order-independent 16-char hex ID for a combo.
//   - Core foundation (no libs): returns foundationID unchanged.
//   - On-demand (has libs): returns sha256(foundationID + "|" + sorted "name:version" list),
//     truncated to 16 hex chars.
//
// This is the SINGLE SOURCE OF TRUTH for combo identity. It MUST be used
// identically by collect, cache-lookup, and cache-append.
func ComboID(foundationID string, libKeys []string) string {
	if len(libKeys) == 0 {
		return foundationID
	}
	sorted := make([]string, len(libKeys))
	copy(sorted, libKeys)
	sort.Strings(sorted)
	canonical := foundationID + "|" + strings.Join(sorted, ",")
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])[:16]
}

// LibraryKeys converts a list of libraries into canonical "name:version" keys
// suitable for ComboID. Since Library.Name is "group:artifact", each key
// becomes "group:artifact:version".
func LibraryKeys(libs []Library) []string {
	keys := make([]string, len(libs))
	for i, lib := range libs {
		keys[i] = lib.Name + ":" + lib.Version
	}
	return keys
}
