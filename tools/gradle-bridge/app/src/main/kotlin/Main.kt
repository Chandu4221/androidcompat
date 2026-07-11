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

    val connector = GradleConnector.newConnector().forProjectDirectory(projectDirFile)

    connector.connect().use { connection ->
        val buildLauncher = connection.newBuild()
            .forTasks(*tasks.toTypedArray())
            .withArguments("--stacktrace")  // no --no-daemon, Tooling API doesn't accept it
            .setStandardOutput(System.err)  // Gradle build logs → stderr
            .setStandardError(System.err)   // Gradle errors → stderr

        javaHome?.let { buildLauncher.setJavaHome(File(it)) }

        var capturedFailures: List<BridgeFailure>? = null
        var failingTask: String? = null
        var status = "success"

        buildLauncher.addProgressListener(
            { event: ProgressEvent ->
                if (event is FinishEvent) {
                    val result = event.result
                    if (result is FailureResult) {
                        status = "failed"
                        failingTask = if (event is TaskFinishEvent) {
                            event.descriptor.taskPath
                        } else {
                            null // config/root-phase failure
                        }
                        capturedFailures = result.failures.map { toBridgeFailure(it) }
                    }
                }
            },
            OperationType.TASK, OperationType.ROOT
        )

        // --- CRITICAL: Redirect the real System.out to stderr for the entire build/provisioning phase ---
        // This captures download progress (e.g., "Downloading https://...") which bypasses BuildLauncher.setStandardOutput()
        val realOut = System.out
        System.setOut(PrintStream(FileOutputStream(FileDescriptor.err)))

        try {
            buildLauncher.run()
        } catch (e: BuildException) {
            status = "failed"
            capturedFailures = listOf(toBridgeFailureFromThrowable(e))
            failingTask = null
        } finally {
            // Restore real stdout so our JSON prints to the correct stream
            System.setOut(realOut)
        }

        // Build final result and print JSON to stdout (clean, no Gradle noise)
        val bridgeResult = BridgeResult(
            status = status,
            task = failingTask,
            failures = capturedFailures ?: emptyList()
        )
        println(Json.encodeToString(BridgeResult.serializer(), bridgeResult))
    }
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