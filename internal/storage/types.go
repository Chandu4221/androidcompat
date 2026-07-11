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

// ---------- Rules (from tracker's rules.json) ----------
type RuleEntry struct {
	Min   string `json:"min"`
	Max   string `json:"max"`
	Value string `json:"value"`
	Type  string `json:"type"`
	Note  string `json:"note,omitempty"`
}

type AgpRules struct {
	RequiredJdk          []RuleEntry `json:"requiredJdk"`
	RequiredGradle       []RuleEntry `json:"requiredGradle"`
	BuiltInKotlinMinimum []RuleEntry `json:"builtInKotlinMinimum"`
	CompileSdkFloors     []RuleEntry `json:"compileSdkFloors"`
}

// NEW: Kotlin rules
type KotlinAgpR8Entry struct {
	KotlinVersion string `json:"kotlinVersion"`
	MinAgp        string `json:"minAgp"`
	MinR8         string `json:"minR8"`
	Note          string `json:"note,omitempty"`
}

type GradlePluginCompatibilityEntry struct {
	KgpRange  string `json:"kgp"`
	GradleMin string `json:"gradleMin"`
	GradleMax string `json:"gradleMax"`
	AgpMin    string `json:"agpMin"`
	AgpMax    string `json:"agpMax"`
	Note      string `json:"note,omitempty"`
}

type KotlinRules struct {
	RequiredAgpR8             []KotlinAgpR8Entry               `json:"requiredAgpR8"`
	GradlePluginCompatibility []GradlePluginCompatibilityEntry `json:"gradlePluginCompatibility"`
}

type GradleRules struct {
	TestedAgpRange interface{} `json:"testedAgpRange"`
	// KotlinEmbedded removed (moved to agp.builtInKotlinMinimum)
}

type KspBuiltInKotlinCompatibility struct {
	MinAgp string `json:"minAgp"`
	MinKsp string `json:"minKsp"`
	Note   string `json:"note,omitempty"`
}

type Rules struct {
	Meta                          interface{}                     `json:"meta"`
	Agp                           AgpRules                        `json:"agp"`
	Kotlin                        KotlinRules                     `json:"kotlin"`
	Gradle                        GradleRules                     `json:"gradle"`
	KspBuiltInKotlinCompatibility []KspBuiltInKotlinCompatibility `json:"kspBuiltInKotlinCompatibility"`
}

// ---------- Combos (candidate generation output) ----------
type Combo struct {
	ID         string `json:"id"`
	AGP        string `json:"agp"`
	Gradle     string `json:"gradle"`
	Kotlin     string `json:"kotlin"`
	KSP        string `json:"ksp"`
	JDK        string `json:"jdk"`
	CompileSdk string `json:"compileSdk"`
	SdkPackage string `json:"sdkPackage"`
}

type CombosFile struct {
	AGPMajor    int     `json:"agpMajor"`
	GeneratedAt string  `json:"generatedAt"`
	Combos      []Combo `json:"combos"`
}

// ---------- Compatibility Results ----------
type VerificationResult struct {
	ID           string `json:"id"`
	AGP          string `json:"agp"`
	Gradle       string `json:"gradle"`
	Kotlin       string `json:"kotlin"`
	KSP          string `json:"ksp"`
	JDK          string `json:"jdk"`
	CompileSdk   string `json:"compileSdk"`
	SdkPackage   string `json:"sdkPackage"`
	Status       string `json:"status"` // "verified", "failed"
	Verification struct {
		Sync     string `json:"sync"`      // "PASSED", "FAILED", "SKIPPED"
		Compile  string `json:"compile"`   // "PASSED", "FAILED", "SKIPPED"
		UnitTest string `json:"unit_test"` // "PASSED", "FAILED", "SKIPPED"
	} `json:"verification"`
	FailureSignature string `json:"failureSignature,omitempty"`
	ErrorMessage     string `json:"errorMessage,omitempty"`
	BuildLog         string `json:"buildLog,omitempty"`
	Timestamp        string `json:"timestamp"`
}

type CompatFile struct {
	AGPMajor int                  `json:"agpMajor"`
	Results  []VerificationResult `json:"results"`
}
