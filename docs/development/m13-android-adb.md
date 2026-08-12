# M13 Android ADB proof contract

M13 adds mobile execution without adding a mobile-specific Flow language. Flow v1 remains semantic; runtime device selection is invocation-scoped; DemoWeave owns Evidence, fingerprints, freshness, and visual review exactly as on other surfaces.

## Architecture

```text
Flow v1 semantic step
        ↓
MobileDriver
        ↓
MobileBackend v1
        ↓
AndroidAdbBackend
  ├─ adb devices
  ├─ uiautomator hierarchy
  ├─ semantic target resolution
  ├─ adb input after semantic resolution
  └─ exec-out screencap -p
        ↓
PNG Evidence + Manifest + freshness
```

No raw coordinates, ADB serials, Android selectors, Appium commands, or emulator launch settings belong in Flow v1.

## Runtime target

The CLI runtime contract is:

```text
demoweave run <flow> --mobile-platform android [--mobile-device-id <serial>]
```

and selective repair may use:

```text
demoweave update <project> --apply --mobile-platform android [--mobile-device-id <serial>]
```

`mobilePlatform` and `mobileDeviceId` are invocation-only. They must not be persisted in ProjectProfile, Flow, Evidence, Manifest, config, or source provenance.

If one ready Android device/emulator is attached, the backend may use it when no serial is supplied. If several are ready, execution must fail and require an explicit device ID. Missing/offline/unauthorized devices must fail clearly.

The `ios` runtime value is reserved by the portable contract but must remain unavailable until an iOS backend is actually implemented and proven on macOS/Xcode.

## Android project detection

`demoweave inspect` must detect a real native Android application rather than requiring a hand-written ProjectProfile.

The first detector should look for owned `src/main/AndroidManifest.xml` files and only create a mobile surface for an application manifest containing an exported/declared launcher activity via `android.intent.action.MAIN` + `android.intent.category.LAUNCHER`.

Do not classify every Android library manifest as a runnable mobile surface. Respect nested initialized DemoWeave project ownership boundaries so a parent repository does not claim a nested fixture's mobile surface.

The detected surface should be deterministic and factual, with framework `Android` and a stable `mobile` surface ID/root.

## Semantic target mapping

The first Android ADB backend maps existing target strategies:

- `automationId` → Android `resource-id`
- `testId` → Android `resource-id`
- `accessibilityId` → `content-desc`
- `text` → UIAutomator `text`
- `label` / `name` → accessible description or text
- `role` → a small explicit Android widget-class map

Resource IDs may match a full package resource ID or its stable `/id` suffix. `exact: false` is only meaningful for text/name/accessibility matching; it must not turn resource IDs into arbitrary substring selectors.

Target searches operate on the current device UI hierarchy. Zero matches produce `TARGET_NOT_FOUND`; multiple matches produce `TARGET_AMBIGUOUS`.

## Actions

Required first real slice:

- `activate`
- `input`
- `press`
- `scroll`
- `wait`
- `assert`
- `capture`

`activate` may tap the center of the semantically resolved element. Coordinates are an internal backend implementation detail only.

`input` must focus a semantically resolved editable control before injecting text. M13 may intentionally support a conservative text subset if raw ADB input escaping cannot be made safe/reliable. The limitation must be documented rather than silently corrupting input. `clear: true` must be proven on the real fixture before it is claimed reliable.

`press` supports an explicit small Android key mapping such as Enter, Tab, Escape/Back, arrows, Home, and End.

`scroll` may translate a semantic scroll target (or whole screen) into a bounded swipe. Direction semantics must be verified on a real emulator/device. No raw Flow coordinates.

Wait/assert support should parallel the existing browser/desktop semantic subset where Android hierarchy data can prove the condition: visible, hidden, targeted text, and targeted `textContains`.

## Screenshot capture

A targetless screenshot capture uses:

```text
adb -s <serial> exec-out screencap -p
```

and returns real PNG bytes to `MobileDriver`. `MobileDriver`, not the backend, validates/writes Evidence and Manifest metadata.

The initial Android backend advertises `screen-capture`, not `element-capture`. A targeted screenshot must fail explicitly until element capture is genuinely implemented.

No display-recorder/video path is part of M13.

## Security and process execution

ADB commands use argument arrays and `shell: false`. Do not construct shell command strings, run arbitrary project-provided ADB fragments, or use `exec`/`Invoke-Expression` style evaluation.

Temporary UI hierarchy data on the device must be removed on success/failure/close where practical. Do not dump environment variables or unrelated device data.

## Real Android fixture

Create a small deterministic native Android application under:

```text
fixtures/mobile-android/
```

Prefer a lightweight XML View-based application over adding Compose/Appium/Maestro merely for this proof. Kotlin or Java is fine; use the locally available Android SDK/Gradle toolchain.

The UI should be polished but intentionally small:

```text
DemoWeave Mobile Fixture

Project name
[                       ]

[ Create ]

<result appears after Create>
```

Stable resource IDs:

```text
project_name
create_button
result
```

No external network assets, random values, clocks, animations, notifications, or machine-specific text.

The final Flow should enter `Demo Project`, activate Create, wait/assert that the result contains `Demo Project`, and capture the full device screenshot.

The fixture must include an actual launcher manifest so `demoweave inspect` discovers the mobile surface.

## Evidence lifecycle

Seed planned screenshot Evidence in the fixture manifest. Successful execution transitions that exact ID to available PNG Evidence with producer:

```text
mobile/android-adb
```

The executor's normal `snapshotFlowEvidence` must add Flow/source/artifact hashes. Device ID/serial must not appear in Evidence provenance.

Commit one intentional real Android screenshot Evidence artifact after visual review. Do not commit emulator images, SDK caches, `.gradle`, `build/`, APK intermediates, device hierarchy dumps, or local SDK paths.

## Freshness proof

Declare only material fixture implementation/config/data source files on the Flow.

Prove:

1. fresh screenshot baseline;
2. mutate one declared material source in a way that affects the app;
3. rebuild/reinstall/relaunch if required by the real Android lifecycle;
4. `status` reports exact source-changed reason;
5. dry-run `update` schedules exactly one producing Flow;
6. `update --apply --mobile-platform android --mobile-device-id <serial>` repairs only that Flow;
7. Evidence returns fresh;
8. second update executes zero actions and produces no Evidence/Manifest byte churn.

If rebuilding/reinstalling changes app process identity, that is fine: Android runtime targeting is by device serial, not app PID. Document the honest sequence.

## Hosted CI boundary

Ubuntu and Windows hosted CI must compile/typecheck/test all portable and ADB protocol behavior with injected/fake `AdbRunner`s. Hosted CI must not claim that a real emulator/device interaction was proven unless the workflow actually provisions one intentionally.

A real local emulator/device proof is required before README/ROADMAP/SKILL claim Android mobile execution as available.

## Local proof gates

On a real emulator/device:

- fixture builds and installs;
- app launches into deterministic state;
- `adb devices` shows the target ready;
- `demoweave inspect` discovers exactly the expected mobile surface;
- Flow executes through `mobile/android-adb`;
- semantic input/activate/wait/assert pass;
- screenshot capture is a valid full-device PNG;
- no device serial is stored in metadata;
- Flow/source/artifact hashes exist;
- screenshot is visually reviewed for clipping, keyboard overlays, status/notification leakage, unintended app/device content, readable sizing, and deterministic final state;
- freshness/selective repair/no-churn proof passes.

## M13 boundaries

Not part of this first Android proof:

- iOS backend;
- Appium/Maestro integration;
- mobile screen recording/video;
- element screenshots;
- arbitrary gestures/multi-touch;
- app-store publishing;
- M14 plugin SDK;
- weakening existing M10 visual-review hash gates.

If Android platform behavior exposes a real contract problem, make the smallest general fix and document it. Do not add Android-only syntax to Flow v1 merely to make the fixture pass.
