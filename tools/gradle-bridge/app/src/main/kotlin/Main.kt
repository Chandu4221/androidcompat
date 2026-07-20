import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.gradle.tooling.BuildException
import org.gradle.tooling.Failure
import org.gradle.tooling.GradleConnector
import org.gradle.tooling.events.FailureResult
import org.gradle.tooling.events.FinishEvent
import org.gradle.tooling.events.OperationType
import org.gradle.tooling.events.ProgressEvent
import org.gradle.tooling.events.task.TaskFinishEvent
import java.io.File
import java.io.FileDescriptor
import java.io.FileOutputStream
import java.io.PrintStream

@Serializable
data class BridgeFailure(
    val description: String,
    val message: String,
    val causes: List<BridgeFailure> = emptyList()
)

@Serializable
data class BridgeResult(
    val status: String,
    val task: String?,
    val failures: List<BridgeFailure>
)

fun main(args: Array<String>) {
    var projectDir: String? = null
    val tasks = mutableListOf<String>()
    var javaHome: String? = null

    var i = 0
    while (i < args.size) {
        when (args[i]) {
            "--project-dir" -> projectDir = args[++i]
            "--tasks" -> {
                while (i + 1 < args.size && !args[i + 1].startsWith("--")) {
                    tasks.add(args[++i])
                }
            }

            "--java-home" -> javaHome = args[++i]
            else -> {}
        }
        i++
    }

    if (projectDir == null || tasks.isEmpty()) {
        System.err.println("Usage: --project-dir <dir> --tasks <task1> [task2 ...] [--java-home <path>]")
        kotlin.system.exitProcess(1)
    }

    val projectDirFile = File(projectDir)
    if (!projectDirFile.exists()) {
        System.err.println("Project directory not found: $projectDir")
        kotlin.system.exitProcess(1)
    }

    // ---------- Retry logic (OUTSIDE the connection) ----------
    val maxAttempts = 3
    var attempt = 0
    var lastException: BuildException? = null
    var capturedFailures: List<BridgeFailure>? = null
    var failingTask: String? = null
    var status = "success"

    while (attempt < maxAttempts) {
        attempt++

        // Reset state for each attempt
        capturedFailures = null
        failingTask = null
        status = "success"
        lastException = null

        // --- NEW: Cache invalidation step (Runs BEFORE connecting) ---
        if (attempt > 1) {
            System.err.println("⚠️ Attempt $attempt/$maxAttempts. Clearing Gradle caches before fresh connection...")
            val gradleHome = System.getProperty("user.home") + "/.gradle"
            val clearCaches = ProcessBuilder("rm", "-rf", "$gradleHome/caches/", "$gradleHome/wrapper/dists/")
                .redirectErrorStream(true)
                .start()
            val exitCode = clearCaches.waitFor()
            if (exitCode != 0) {
                System.err.println("⚠️ Cache clear failed with exit code $exitCode")
            } else {
                System.err.println("✅ Gradle caches cleared successfully.")
            }
        }
        // ----------------------------------------------------------

        // Create a BRAND NEW connector and connection for THIS attempt
        val connector = GradleConnector.newConnector().forProjectDirectory(projectDirFile)

        // .use {} ensures the connection is safely closed even if it crashes
        connector.connect().use { connection ->
            val buildLauncher = connection.newBuild()
                .forTasks(*tasks.toTypedArray())
                .withArguments("--stacktrace")
                .setStandardOutput(System.err)
                .setStandardError(System.err)

            javaHome?.let { buildLauncher.setJavaHome(File(it)) }

            // Register progress listener for this specific connection
            buildLauncher.addProgressListener(
                { event: ProgressEvent ->
                    if (event is FinishEvent) {
                        val result = event.result
                        if (result is FailureResult) {
                            status = "failed"
                            failingTask = if (event is TaskFinishEvent) {
                                event.descriptor.taskPath
                            } else {
                                null
                            }
                            capturedFailures = result.failures.map { toBridgeFailure(it) }
                        }
                    }
                },
                OperationType.TASK, OperationType.ROOT
            )

            // Redirect stdout to stderr for provisioning noise
            val realOut = System.out
            System.setOut(PrintStream(FileOutputStream(FileDescriptor.err)))

            try {
                buildLauncher.run()
                // Success – break out of retry loop
                break
            } catch (e: BuildException) {
                // Check for BOTH distribution connection failures AND protobuf wire corruption
                val isProvisioningFailure =
                    e.message?.contains("Could not execute build using connection to Gradle distribution") == true ||
                            e.message?.contains("Protocol message contained an invalid tag") == true

                if (isProvisioningFailure && attempt < maxAttempts) {
                    System.err.println("⚠️ Provisioning/Protocol failure (attempt $attempt/$maxAttempts). Will retry...")
                    lastException = e
                    Thread.sleep(8000)
                    // Loop continues – connection will be closed by .use {}, cache cleared, and new connection made
                } else {
                    // Real failure or out of retries
                    status = "failed"
                    if (capturedFailures == null) {
                        capturedFailures = listOf(toBridgeFailureFromThrowable(e))
                        failingTask = null
                    }
                    break
                }
            } finally {
                // Restore stdout for JSON printing
                System.setOut(realOut)
            }
        } // connection safely closed here by .use {}
    }

    // If we exhausted retries without success, record the last provisioning failure
    if (attempt == maxAttempts && lastException != null && status == "success") {
        status = "failed"
        capturedFailures = listOf(toBridgeFailureFromThrowable(lastException))
        failingTask = null
    }

    // Build final result and print JSON to stdout
    val bridgeResult = BridgeResult(
        status = status,
        task = failingTask,
        failures = capturedFailures ?: emptyList()
    )
    println(Json.encodeToString(BridgeResult.serializer(), bridgeResult))
}

fun toBridgeFailure(failure: Failure): BridgeFailure {
    val causes = failure.causes.map { toBridgeFailure(it) }
    return BridgeFailure(
        description = failure.description ?: "",
        message = failure.message ?: "",
        causes = causes
    )
}

fun toBridgeFailureFromThrowable(t: Throwable): BridgeFailure {
    val causes = if (t.cause != null && t.cause != t) {
        listOf(toBridgeFailureFromThrowable(t.cause!!))
    } else emptyList()
    return BridgeFailure(
        description = t.stackTraceToString(),
        message = t.message ?: "",
        causes = causes
    )
}