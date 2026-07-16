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
	Min    string `json:"min"`
	Max    string `json:"max"`
	Value  string `json:"value"`
	Type   string `json:"type"`
	Note   string `json:"note,omitempty"`
	Source string `json:"source,omitempty"`
}

type AgpRules struct {
	RequiredJdk          []RuleEntry `json:"requiredJdk"`
	RequiredGradle       []RuleEntry `json:"requiredGradle"`
	BuiltInKotlinMinimum []RuleEntry `json:"builtInKotlinMinimum"`
	CompileSdkFloors     []RuleEntry `json:"compileSdkFloors"`
}

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
	Hilt                          HiltRules                       `json:"hilt"`
	Compose                       ComposeRules                    `json:"compose"`
	Room                          RoomRules                       `json:"room"`
	Navigation                    NavigationRules                 `json:"navigation"`
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
	Sync     string `json:"sync"`      // "PASSED", "FAILED", "SKIPPED"
	Compile  string `json:"compile"`   // "PASSED", "FAILED", "SKIPPED"
	UnitTest string `json:"unit_test"` // "PASSED", "FAILED", "SKIPPED"
}

type VerificationResult struct {
	ID               string             `json:"id"`
	Timestamp        string             `json:"timestamp"`
	CoreToolchain    CoreToolchain      `json:"coreToolchain"`
	Libraries        []Library          `json:"libraries"`
	Status           string             `json:"status"` // "verified", "failed"
	FailureSignature string             `json:"failureSignature,omitempty"`
	ErrorMessage     string             `json:"errorMessage,omitempty"`
	Verification     VerificationStatus `json:"verification"`
	BuildLog         string             `json:"buildLog,omitempty"`
}

type CompatFile struct {
	AGPMajor int                  `json:"agpMajor"`
	Results  []VerificationResult `json:"results"`
}

// ---------- Phase B Rule Structs ----------
type HiltRules struct {
	RequiredAgp []RuleEntry `json:"requiredAgp"`
}

type RoomRules struct {
	GradlePluginRequiredAgp []RuleEntry `json:"gradlePluginRequiredAgp"`
	MinKotlin               []RuleEntry `json:"minKotlin"`
}

type NavigationRules struct {
	SafeArgsRequiredAgp []RuleEntry `json:"safeArgsRequiredAgp"`
}

type ComposeCompilerPin struct {
	Compiler string `json:"compiler"`
	Kotlin   string `json:"kotlin"`
}

type ComposeModernPin struct {
	MinKotlin string `json:"minKotlin"`
	Note      string `json:"note,omitempty"`
	Source    string `json:"source,omitempty"`
}

type ComposeRules struct {
	CompilerKotlinExactPinLegacy []ComposeCompilerPin `json:"compilerKotlinExactPin_legacy"`
	CompilerKotlinExactPinModern ComposeModernPin     `json:"compilerKotlinExactPin_modern"`
}
