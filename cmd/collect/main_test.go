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
			name: "compile_sdk_mismatch",
			failure: &BridgeFailure{
				Description: "Compilation failed",
				Message:     "requires libraries and applications that depend on it to compile against version 34",
			},
			expected: "compile_sdk_mismatch",
		},
		{
			name: "lint_target_sdk_inversion",
			failure: &BridgeFailure{
				Description: "Lint found errors",
				Message:     "The compileSdkVersion (34) should not be lower than the targetSdkVersion (35) [GradleCompatible]",
			},
			expected: "compile_sdk_mismatch", // Maps to compile_sdk_mismatch based on current logic
		},
		{
			name: "infra_provisioning_error",
			failure: &BridgeFailure{
				Description: "Network failure",
				Message:     "Could not execute build using connection to Gradle distribution",
			},
			expected: "infra_provisioning_error",
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
