# DemoWeave Android fixture

This tiny Java/XML application is the real-device proof for DemoWeave's Android ADB backend. It has no network access or third-party UI framework and exposes stable Android resource IDs for the project-name field, Create button, and result text.

Build, install, and launch the app separately from the Flow. From a native Windows shell with the Android SDK available:

```powershell
Set-Location C:\path\to\demoweave\fixtures\mobile-android
.\gradlew.bat assembleDebug
adb -s <serial> install -r .\build\outputs\apk\debug\DemoWeaveMobileFixture-debug.apk
adb -s <serial> shell am force-stop dev.demoweave.fixture
adb -s <serial> shell am start -W -n dev.demoweave.fixture/.MainActivity
```

Then run the built DemoWeave CLI from the repository root:

```powershell
node packages/cli/dist/index.js inspect fixtures/mobile-android
node packages/cli/dist/index.js validate fixtures/mobile-android
node packages/cli/dist/index.js run create-project `
  --project fixtures/mobile-android `
  --mobile-platform android `
  --mobile-device-id <serial>
node packages/cli/dist/index.js status fixtures/mobile-android
```

DemoWeave attaches to an already-ready device and already-running app; it does not build, install, or launch arbitrary applications. The Flow contains semantic resource IDs only—no ADB commands, coordinates, package/activity names, or device serial. Android ADB text input is intentionally limited to letters, digits, spaces, and `_ . , : + - @ /`; `clear: true` deletes the current UIAutomator-visible field text before entering the new value. Element screenshots, mobile video, arbitrary gestures, and iOS execution are not implemented.
