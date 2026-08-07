package storage

import "time"

// ---------- Version Registry (from tracker) ----------

type VersionEntry struct {
	Version    string    `json:"version"`
	Status     string    `json:"status"`
	DetectedAt time.Time `json:"detectedAt"`
	Source     string    `json:"source"`
	ReleasedAt time.Time `json:"releasedAt"`
	Facts      []Fact    `json:"facts,omitempty"`
}

type Fact struct {
	Type       string `json:"type"`
	Value      string `json:"value"`
	Source     string `json:"source"`
	Confidence string `json:"confidence"`
}

type VersionRegistry struct {
	AGP       map[string]VersionEntry            `json:"agp"`
	Kotlin    map[string]VersionEntry            `json:"kotlin"`
	KSP       map[string]VersionEntry            `json:"ksp"`
	Gradle    map[string]VersionEntry            `json:"gradle"`
	Libraries map[string]map[string]VersionEntry `json:"libraries"` // key: "group:artifact"
}

// ---------- Shared Core & Library Structures ----------

type CoreToolchain struct {
	AGP        string `json:"agp"`
	Gradle     string `json:"gradle"`
	Kotlin     string `json:"kotlin"`
	KSP        string `json:"ksp"`
	JDK        string `json:"jdk"`
	CompileSdk string `json:"compileSdk"`
	SdkPackage string `json:"sdkPackage"`
}

type Library struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// ---------- Combos (candidate generation output) ----------

type Combo struct {
	ID            string        `json:"id"`
	CoreToolchain CoreToolchain `json:"coreToolchain"`
	Libraries     []Library     `json:"libraries"`
}

type CombosFile struct {
	AGPMajor    int     `json:"agpMajor"`
	GeneratedAt string  `json:"generatedAt"`
	Combos      []Combo `json:"combos"`
}

// ---------- Compatibility Results ----------

type VerificationStatus struct {
	Sync     string `json:"sync"`
	Compile  string `json:"compile"`
	UnitTest string `json:"unit_test"`
}

type VerificationResult struct {
	ID               string             `json:"id"`
	Timestamp        string             `json:"timestamp"`
	WorkflowURL      string             `json:"workflowUrl,omitempty"`
	CoreToolchain    CoreToolchain      `json:"coreToolchain"`
	Libraries        []Library          `json:"libraries"`
	Status           string             `json:"status"`
	FailureSignature string             `json:"failureSignature,omitempty"`
	ErrorMessage     string             `json:"errorMessage,omitempty"`
	Verification     VerificationStatus `json:"verification"`
	BuildLog         string             `json:"buildLog,omitempty"`
}

type CompatFile struct {
	AGPMajor int                  `json:"agpMajor"`
	Results  []VerificationResult `json:"results"`
}
