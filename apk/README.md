# GETGO Android app (APK)

An Android app that opens **https://www.getandgo.site** full screen, as a
[Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity)
(TWA). The app is the website: every update to the site shows up in the app
right away, with no new APK needed.

- Opens without a browser bar, with a pink GETGO splash screen
- Sign-in, location, photo upload, GCash and SMS links work like on the website
- Links to `www.getandgo.site` open in the app
- Package: `site.getandgo.app` · Android 8.0 and newer
- Needs Chrome (or another browser that supports TWAs) on the phone. Without
  one, the site opens in a Custom Tab instead.

## Install the APK

The latest build is `release/getgo-1.0.0.apk`. Copy it to a phone, open it and
allow "Install unknown apps" when asked.

## How full screen works

Android shows the site without a browser bar only when the site vouches for
the app. The site does that in `public/.well-known/assetlinks.json` (served at
`https://www.getandgo.site/.well-known/assetlinks.json`), which lists the app's
package name and its signing key's SHA-256 fingerprint:

```
FF:6C:89:CC:28:F6:8A:D8:95:89:94:15:51:DD:F4:34:42:35:CA:11:BC:A2:14:FD:2D:49:D0:C6:5E:C1:D4:15
```

Until that file is live on the site, the app still works but shows a small URL
bar at the top.

If you publish on Google Play with **Play App Signing**, Google re-signs the
app with its own key. Add that key's SHA-256 (Play Console → Setup → App
signing) to `sha256_cert_fingerprints` in `assetlinks.json` too.

## Signing key (keep it safe)

The release key is `getgo-release.jks`, and its passwords are in
`keystore.properties`. Both are **not committed to git**. Back them up
somewhere safe (for example a password manager and a private drive). Every
future update of the app must be signed with the same key. If it's lost,
Android won't install updates over the existing app.

## Build

Needs Android Studio (for its Java and the Android SDK).

```
cd apk
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr     (PowerShell: $env:JAVA_HOME = "...")
gradlew assembleRelease
```

The signed APK is written to `app/build/outputs/apk/release/app-release.apk`.
For Google Play, build an app bundle with `gradlew bundleRelease` (the `.aab`
is in `app/build/outputs/bundle/release/`).

To release an update, raise `versionCode` (and `versionName`) in
`app/build.gradle.kts` first.

## What to change where

| What | Where |
|---|---|
| Website address | `siteHost` in `app/build.gradle.kts`, and `asset_statements` in `res/values/strings.xml` |
| App name | `app_name` in `res/values/strings.xml` |
| Colors (splash, status bar) | `res/values/colors.xml` |
| App icon, splash logo, notification icon | `res/drawable/` (the GO logo as vectors) |
