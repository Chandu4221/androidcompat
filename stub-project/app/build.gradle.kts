plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "dev.androidcompat.stub"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.androidcompat.stub"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}