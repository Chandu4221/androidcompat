package main

import (
	"testing"
)

func TestMapBridgeFailureToSignature(t *testing.T) {
	tests := []struct {
		name     string
		failure  *BridgeFailure
		expected string
	}{
		{
			name: "hilt_gradle_kotlin_metadata_floor",
			failure: &BridgeFailure{
				Description: "org.jetbrains.kotlin.protobuf.InvalidProtocolBufferException: Protocol message contained an invalid tag (zero).",
				Message:     "Protocol message contained an invalid tag (zero).",
			},
			expected: "hilt_gradle_kotlin_metadata_floor",
		},
		{
			name: "hilt_ksp_scoping_error",
			failure: &BridgeFailure{
				Description: "Hilt plugin error: class loader mismatch in sub-project",
				Message:     "KSP execution failed for hilt-android-gradle-plugin",
			},
			expected: "hilt_ksp_scoping_error",
		},
		{
			name: "lint_target_sdk_inversion",
			failure: &BridgeFailure{
				Description: "Lint found errors in the following tasks: [GradleCompatible]",
				Message:     "The compileSdkVersion (34) should not be lower than the targetSdkVersion (35) [GradleCompatible]",
			},
			expected: "lint_target_sdk_inversion",
		},
		{
			name: "compile_sdk_mismatch",
			failure: &BridgeFailure{
				Description: "Compilation failed",
				Message:     "requires libraries and applications that depend on it to compile against version 34",
			},
			expected: "compile_sdk_mismatch",
		},
		{
			name: "ksp_version_mismatch",
			failure: &BridgeFailure{
				Description: "KSP execution failed",
				Message:     "e: [ksp] Unable to find KSP processor",
			},
			expected: "ksp_version_mismatch",
		},
		{
			name: "dependency_fetch_error",
			failure: &BridgeFailure{
				Description: "Network failure",
				Message:     "Could not download core-ktx.aar: Received status code 403 from server: Forbidden",
			},
			expected: "dependency_fetch_error",
		},
		{
			name: "infra_provisioning_error",
			failure: &BridgeFailure{
				Description: "Network failure",
				Message:     "Could not execute build using connection to Gradle distribution",
			},
			expected: "infra_provisioning_error",
		},
		{
			name: "build_failure_fallback",
			failure: &BridgeFailure{
				Description: "Some random gradle error",
				Message:     "Something went wrong but no specific signature matched",
			},
			expected: "build_failure",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := mapBridgeFailureToSignature(tt.failure)
			if result != tt.expected {
				t.Errorf("mapBridgeFailureToSignature() = %v, want %v", result, tt.expected)
			}
		})
	}
}
