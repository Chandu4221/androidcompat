plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.androidcompat.stub"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.androidcompat.stub"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

     compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
}