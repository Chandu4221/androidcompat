// Top-level build file for AGP 7 stub project.
// AGP 7 requires kotlin.android applied here — unlike AGP 9 which has built-in Kotlin support.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
}
