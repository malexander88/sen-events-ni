# Android app — SEN Events NI

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
