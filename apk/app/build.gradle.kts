import java.util.Properties

plugins {
    id("com.android.application")
}

// The site this app opens. The app runs it full screen as a Trusted Web
// Activity; the site proves it trusts the app in /.well-known/assetlinks.json.
val siteHost = "www.getandgo.site"
val siteUrl = "https://$siteHost/"

// Release signing: keystore.properties (not committed) points at the keystore.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "site.getandgo.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "site.getandgo.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        manifestPlaceholders["siteHost"] = siteHost
        manifestPlaceholders["siteUrl"] = siteUrl
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Google's Trusted Web Activity launcher: opens the site in Chrome without
    // a browser bar, with a splash screen and a fallback to a Custom Tab.
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
