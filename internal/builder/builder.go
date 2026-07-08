package builder

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/Chandu4221/androidcompat/internal/storage"
)

// BuildResult captures the outcome of a Gradle build
type BuildResult struct {
	Success  bool
	ExitCode int
	Stdout   string
	Stderr   string
	Stage    string // "sync", "compile", "unit_test", "instrumentation"
	Duration time.Duration
	Task     string // Name of failed task if any
}

// PrepareBuildDir copies the stub template for the given AGP major to a temp directory
// and injects the combo's version values into the appropriate files.
// Returns the path to the prepared build directory.
func PrepareBuildDir(agpMajor int, combo *storage.Combo) (string, error) {
	// 1. Source stub path
	srcDir := filepath.Join("stubs", fmt.Sprintf("agp%d", agpMajor))
	if _, err := os.Stat(srcDir); os.IsNotExist(err) {
		return "", fmt.Errorf("stub template not found: %s", srcDir)
	}

	// 2. Create temp directory
	tmpDir, err := os.MkdirTemp("", fmt.Sprintf("androidcompat-agp%d-", agpMajor))
	if err != nil {
		return "", fmt.Errorf("failed to create temp dir: %w", err)
	}

	// 3. Copy entire stub directory recursively
	if err := copyDir(srcDir, tmpDir); err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("failed to copy stub: %w", err)
	}

	// 4. Inject versions
	if err := injectVersions(tmpDir, agpMajor, combo); err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("failed to inject versions: %w", err)
	}

	return tmpDir, nil
}

// injectVersions modifies the stub files with the combo's version values
func injectVersions(buildDir string, agpMajor int, combo *storage.Combo) error {
	// For AGP 8/9, we have libs.versions.toml
	if agpMajor >= 8 {
		tomlPath := filepath.Join(buildDir, "gradle", "libs.versions.toml")
		if err := replaceInFile(tomlPath, map[string]string{
			`agp\s*=\s*".*"`:    fmt.Sprintf(`agp = "%s"`, combo.AGP),
			`kotlin\s*=\s*".*"`: fmt.Sprintf(`kotlin = "%s"`, combo.Kotlin),
		}); err != nil {
			return fmt.Errorf("failed to update libs.versions.toml: %w", err)
		}
	} else {
		// AGP 7 uses Groovy build.gradle files
		rootGradle := filepath.Join(buildDir, "build.gradle")
		if err := replaceInFile(rootGradle, map[string]string{
			`classpath "com.android.tools.build:gradle:[^"]*"`:            fmt.Sprintf(`classpath "com.android.tools.build:gradle:%s"`, combo.AGP),
			`classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:[^"]*"`: fmt.Sprintf(`classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:%s"`, combo.Kotlin),
		}); err != nil {
			return fmt.Errorf("failed to update root build.gradle: %w", err)
		}
	}

	// Always update gradle-wrapper.properties
	wrapperProps := filepath.Join(buildDir, "gradle", "wrapper", "gradle-wrapper.properties")
	if err := replaceInFile(wrapperProps, map[string]string{
		`distributionUrl=.*`: fmt.Sprintf(`distributionUrl=https\://services.gradle.org/distributions/gradle-%s-bin.zip`, combo.Gradle),
	}); err != nil {
		return fmt.Errorf("failed to update gradle-wrapper.properties: %w", err)
	}

	return nil
}

// replaceInFile performs regex-based search and replace on a file.
func replaceInFile(filePath string, replacements map[string]string) error {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	newContent := string(content)
	for pattern, replacement := range replacements {
		re, err := regexp.Compile(pattern)
		if err != nil {
			return fmt.Errorf("invalid regex pattern %q: %w", pattern, err)
		}
		newContent = re.ReplaceAllString(newContent, replacement)
	}

	return os.WriteFile(filePath, []byte(newContent), 0644)
}

// RunBuild executes ./gradlew build in the given directory and captures output.
// It returns a BuildResult with the outcome.
func RunBuild(buildDir string) (*BuildResult, error) {
	start := time.Now()

	cmd := exec.Command("./gradlew", "build", "--no-daemon", "--stacktrace")
	cmd.Dir = buildDir

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	duration := time.Since(start)

	result := &BuildResult{
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		Duration: duration,
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else {
			result.ExitCode = -1
		}
		result.Success = false
		// Try to extract failed task from stderr
		lines := strings.Split(result.Stderr, "\n")
		for _, line := range lines {
			if strings.Contains(line, "> Task :") && strings.Contains(line, "FAILED") {
				result.Task = strings.TrimSpace(strings.Split(line, "> Task :")[1])
				break
			}
		}
		// Determine which stage failed: sync, compile, etc.
		if strings.Contains(result.Stderr, "FAILURE: Build failed with an exception.") {
			if strings.Contains(result.Stderr, "What went wrong:") {
				if strings.Contains(result.Stderr, "Could not resolve all dependencies") {
					result.Stage = "sync"
				} else if strings.Contains(result.Stderr, "Compilation failed") || strings.Contains(result.Stderr, "compile") {
					result.Stage = "compile"
				} else {
					result.Stage = "build"
				}
			}
		}
	} else {
		result.Success = true
		result.ExitCode = 0
		result.Stage = "compile" // build succeeded, reached compile stage
	}

	return result, nil
}

// copyDir recursively copies a source directory to a destination
func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		destPath := filepath.Join(dst, relPath)

		if info.IsDir() {
			return os.MkdirAll(destPath, info.Mode())
		}

		// Handle symlinks if needed
		if info.Mode()&os.ModeSymlink != 0 {
			// Skip symlinks for simplicity
			return nil
		}

		srcFile, err := os.Open(path)
		if err != nil {
			return err
		}
		defer srcFile.Close()

		destFile, err := os.Create(destPath)
		if err != nil {
			return err
		}
		defer destFile.Close()

		if _, err := io.Copy(destFile, srcFile); err != nil {
			return err
		}
		return nil
	})
}
