# Android app — Out & About NI

Minimal WebView wrapper around the `www/` UI.

## Build

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64   # or your JDK 17+
export ANDROID_HOME=/path/to/android-sdk
cd android
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Sideload on Android: enable “Install unknown apps”, then open the APK.

## Play Store release build (v2.0.0+)

Release signing reads `android/keystore.properties` (git-ignored; or set `KEYSTORE_PROPERTIES=/path/to/file`):

```
storeFile=/workspace/store-release/upload-keystore.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

Then `./gradlew bundleRelease assembleRelease` (JDK 17, Android SDK platform 36). Without the file, release
outputs are unsigned. The upload keystore and its password are never committed.
