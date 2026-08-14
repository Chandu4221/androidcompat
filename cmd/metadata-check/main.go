package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// LibCoord represents a single library addon (same format as inject/collect)
type LibCoord struct {
	Group    string `json:"group"`
	Artifact string `json:"artifact"`
	Version  string `json:"version"`
}

var httpClient = &http.Client{Timeout: 30 * time.Second}

func baseURLFor(group string) string {
	if strings.HasPrefix(group, "androidx.") || strings.HasPrefix(group, "com.android.") || strings.HasPrefix(group, "com.google.android.") {
		return "https://dl.google.com/dl/android/maven2"
	}
	return "https://repo1.maven.org/maven2"
}

// fetchAarMinCompileSdk downloads the AAR and reads minCompileSdk from aar-metadata.properties
func fetchAarMinCompileSdk(baseURL, group, artifact, version string) (int, error) {
	groupPath := strings.ReplaceAll(group, ".", "/")
	url := fmt.Sprintf("%s/%s/%s/%s/%s-%s.aar", baseURL, groupPath, artifact, version, artifact, version)

	resp, err := httpClient.Get(url)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return 0, fmt.Errorf("AAR not found: HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, err
	}

	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return 0, fmt.Errorf("not a valid ZIP/AAR: %w", err)
	}

	for _, f := range reader.File {
		if f.Name == "META-INF/com/android/build/gradle/aar-metadata.properties" {
			rc, err := f.Open()
			if err != nil {
				return 0, err
			}
			defer rc.Close()
			content, err := io.ReadAll(rc)
			if err != nil {
				return 0, err
			}
			for _, line := range strings.Split(string(content), "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "minCompileSdk=") {
					val := strings.TrimPrefix(line, "minCompileSdk=")
					return strconv.Atoi(strings.TrimSpace(val))
				}
			}
			return 0, nil // file exists but no minCompileSdk declared
		}
	}
	return 0, nil // no aar-metadata.properties (older library, no constraint)
}

// fetchModuleBytecode downloads the .module file and reads the max JVM version
func fetchModuleBytecode(baseURL, group, artifact, version string) (int, error) {
	groupPath := strings.ReplaceAll(group, ".", "/")
	url := fmt.Sprintf("%s/%s/%s/%s/%s-%s.module", baseURL, groupPath, artifact, version, artifact, version)

	resp, err := httpClient.Get(url)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return 0, fmt.Errorf("module metadata not found: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, err
	}

	var module struct {
		Variants []struct {
			Name       string                 `json:"name"`
			Attributes map[string]interface{} `json:"attributes"`
		} `json:"variants"`
	}
	if err := json.Unmarshal(body, &module); err != nil {
		return 0, err
	}

	maxJDK := 0
	for _, v := range module.Variants {
		if attr, ok := v.Attributes["org.gradle.jvm.version"]; ok {
			switch val := attr.(type) {
			case float64:
				if int(val) > maxJDK {
					maxJDK = int(val)
				}
			case int:
				if val > maxJDK {
					maxJDK = val
				}
			case string:
				if i, err := strconv.Atoi(val); err == nil && i > maxJDK {
					maxJDK = i
				}
			}
		}
	}
	return maxJDK, nil
}

func main() {
	libsFlag := flag.String("libs", "", `JSON array: [{"group":"...","artifact":"...","version":"..."}]`)
	compileSdk := flag.Int("compile-sdk", 0, "Foundation's compileSdk")
	jdk := flag.String("jdk", "", "Foundation's JDK version (e.g., 17)")
	outFlag := flag.String("out", "", "Output file for failure details (JSON array)")
	flag.Parse()

	if *libsFlag == "" || *compileSdk == 0 {
		fmt.Fprintln(os.Stderr, "❌ --libs and --compile-sdk are required")
		os.Exit(1)
	}

	var libs []LibCoord
	if err := json.Unmarshal([]byte(*libsFlag), &libs); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Invalid --libs JSON: %v\n", err)
		os.Exit(1)
	}

	jdkInt := 17
	if *jdk != "" && *jdk != "null" {
		if v, err := strconv.Atoi(*jdk); err == nil {
			jdkInt = v
		}
	}

	fmt.Printf("🔍 Metadata Gate: checking %d addon(s) against compileSdk=%d, JDK=%d\n", len(libs), *compileSdk, jdkInt)

	var failures []string

	for _, lib := range libs {
		baseURL := baseURLFor(lib.Group)
		coord := fmt.Sprintf("%s:%s:%s", lib.Group, lib.Artifact, lib.Version)
		fmt.Printf("\n📦 Checking %s\n", coord)

		// Check 1: minCompileSdk from AAR metadata
		minSdk, err := fetchAarMinCompileSdk(baseURL, lib.Group, lib.Artifact, lib.Version)
		if err != nil {
			fmt.Printf("   ⚠️  Could not check AAR metadata: %v\n", err)
		} else if minSdk > 0 {
			if minSdk > *compileSdk {
				msg := fmt.Sprintf("`%s` requires compileSdk %d, but Foundation has compileSdk %d", coord, minSdk, *compileSdk)
				fmt.Printf("   ❌ FAIL: %s\n", msg)
				failures = append(failures, msg)
			} else {
				fmt.Printf("   ✅ minCompileSdk=%d (≤ %d)\n", minSdk, *compileSdk)
			}
		} else {
			fmt.Printf("   ℹ️  No minCompileSdk declared\n")
		}

		// Check 2: Bytecode level from .module metadata
		bytecode, err := fetchModuleBytecode(baseURL, lib.Group, lib.Artifact, lib.Version)
		if err != nil {
			fmt.Printf("   ⚠️  Could not check bytecode: %v\n", err)
		} else if bytecode > 0 {
			if bytecode > jdkInt {
				msg := fmt.Sprintf("`%s` targets JDK %d bytecode, but Foundation runs JDK %d", coord, bytecode, jdkInt)
				fmt.Printf("   ❌ FAIL: %s\n", msg)
				failures = append(failures, msg)
			} else {
				fmt.Printf("   ✅ bytecode=%d (≤ JDK %d)\n", bytecode, jdkInt)
			}
		} else {
			fmt.Printf("   ℹ️  No JVM version declared\n")
		}
	}

	if len(failures) > 0 {
		fmt.Printf("\n❌ METADATA GATE FAILED: %d violation(s)\n", len(failures))
		if *outFlag != "" {
			data, _ := json.MarshalIndent(failures, "", "  ")
			os.WriteFile(*outFlag, data, 0644)
		}
		os.Exit(1)
	}

	fmt.Printf("\n✅ METADATA GATE PASSED: all %d addon(s) compatible\n", len(libs))
}
