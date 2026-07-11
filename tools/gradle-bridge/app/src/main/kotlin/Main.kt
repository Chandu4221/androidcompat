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

    // 1. Connector – do NOT use useInstallation (that's for Gradle distribution, not JDK)
    val connector = GradleConnector.newConnector().forProjectDirectory(projectDirFile)

    connector.connect().use { connection ->
        // 2. Build launcher – set Java home here, NOT on the connector
        val buildLauncher = connection.newBuild()
            .forTasks(*tasks.toTypedArray())
            .withArguments("--info", "--stacktrace")

        // This is the correct way to target a specific JDK for the build
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

        try {
            buildLauncher.run()
        } catch (e: BuildException) {
            status = "failed"
            capturedFailures = listOf(toBridgeFailureFromThrowable(e))
            failingTask = null
        }

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