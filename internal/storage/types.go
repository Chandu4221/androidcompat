package storage

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
