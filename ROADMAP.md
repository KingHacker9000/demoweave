# DemoWeave Roadmap

DemoWeave is an agent-native documentation studio for software repositories. Claude Code, Codex, or another coding agent supplies reasoning, writing, and visual judgment; DemoWeave supplies deterministic project inspection, workflow execution, evidence capture, rendering, composition, tutorial packaging, visual-review preparation/binding, freshness analysis, safe Markdown patching, validation, and provenance.

DemoWeave is **multi-surface by design**. A repository may expose web, CLI, desktop, mobile, libraries/SDKs, notebooks, research pipelines, services, and generated artifacts at the same time.

## Current checkpoint

| Milestone | Status | Result |
|---|---|---|
| M0 — Repository bootstrap | ✅ Complete | TypeScript/pnpm monorepo, CLI, package boundaries, CI |
| M1 — Project analyzer | ✅ Complete | `ProjectProfile v1`; Node, Python, Rust, Go baseline |
| M2 — Flow / Evidence / Manifest | ✅ Complete | Platform-neutral workflow/evidence contracts + `SurfaceDriver v1` |
| M3 — Terminal driver | ✅ Complete | Cross-platform Flow execution + `TerminalTrack v1` |
| M4 — Media renderer | ✅ Complete | TerminalTrack → polished PNG/GIF + derived Evidence |
| P0 — DemoWeave documents itself | ✅ Complete | First public-quality dogfood README using real DemoWeave evidence |
| M5 — Safe Markdown patching | ✅ Complete | Section-aware plan → preview/review token → atomic apply |
| M6 — Incremental stale tracking | ✅ Complete | Explainable freshness → minimal selective regeneration → no-change/no-churn |
| M7 — Web driver (Playwright) | ✅ Complete | Semantic browser Flow execution + fingerprinted PNG screenshot Evidence |
| P1 — Web fixture pilot | ✅ Complete | Browser Evidence + reviewed docs + stale/selective-regeneration proof |
| M8 — Timeline compositor | ✅ Complete | `TimelinePlan v1`; local Evidence/media → deterministic MP4/GIF without OBS |
| M9 — Tutorial output | ✅ Complete | `TutorialPlan v1`; existing MP4 Evidence → upload-oriented package |
| M10 — Visual QA | ✅ Complete | Deterministic sample packet → agent-reviewed hash-bound PASS/NEEDS-CHANGES report |
| M11 — Research / notebook driver | ✅ Complete | Explicit research/notebook execution → immutable native plot/table/result/IPYNB Evidence |
| M12 — Desktop drivers | 🚧 Partial | Portable backend boundary + proven Windows UI Automation/window-capture backend; macOS/Linux deferred |
| M13 — Mobile drivers | 🚧 Partial | Android ADB/UIAutomator + device screenshot proven; iOS planned |
| M14 — Plugin/driver SDK | ✅ Complete | Trusted detectors, driver factories, renderer plugins, fingerprints, freshness, and external fixture proof |
| **M15 — Documentation publishers** | **🚧 Current** | **Publisher contract and integrations are next; no publisher runtime is implemented yet** |

Milestone PR history: M0/M1 #1, M2 #2, M3 #3, M4 #4, P0 #5, M5 #6, M6 #7, M7 #8, M5 hardening #9, P1 #10, M8 #11, M9 #12, M10 #13, M11 #14, M12A #15, M12B #16, M13 Android #17, M14A #19. M14B is tracked in draft PR #20.
## Product principles

- **Agent supplies intelligence; DemoWeave supplies deterministic tooling.**
- **Evidence over decoration.** Visuals must explain or prove something useful.
- **Multi-surface by design.** Never collapse a repository into one `projectType`.
- **Capture, presentation, and review are separate stages.**
- **Prefer native artifacts over UI recordings when the native artifact is the result users care about.**
- **No OBS requirement.** Capture the smallest useful surface directly and compose later.
- **No hidden LLM calls.** The agent authors prose, tutorial narrative, and visual-QA findings.
- **Preserve good existing documentation.** Patch intentionally instead of regenerating blindly.
- **README.md and arbitrary Markdown are first-class targets.** `/docs` is not special.
- **Freshness before regeneration or review.** Unknown/stale evidence is never silently treated as current.
- **One source of truth for demos.** Structured Flows feed Evidence; presentation plans derive media without rewriting what happened.
- **Generated output is not automatically a source dependency.** Material code/config/data belongs in Flow `sources`; captured output bytes become immutable Evidence.
- **Claude Code and Codex share the same workflow contracts.**
- Keep the core lightweight; platform-specific drivers/renderers stay isolated.

## Established pipeline

```text
Repository
  ↓
ProjectProfile v1
  ↓
Agent reasoning
  ↓
Flow v1 + declared sources
  ↓
SurfaceDriver v1
  ├─ terminal → TerminalTrack Evidence
  ├─ web/Playwright → screenshot Evidence
  └─ research/notebook → native artifact Evidence
                         (plot/table/result/image/video/IPYNB)
  ↓
Evidence v1 + Manifest v1 + fingerprints
  ├─ terminal renderer → PNG / GIF
  └─ TimelinePlan v1 → MP4 / GIF composition
                         ↓
                    TutorialPlan v1
                         ↓
          MP4 + thumbnail + SRT/VTT
          + chapters + description + metadata
                         ↓
                 VisualQAPacket v1
                         ↓
                  Agent visual review
                         ↓
                 VisualQAReport v1
  ↓
FreshnessReport v1
  ↓
minimal selective update where supported
  ↓
DocumentPlan v1
  ↓
reviewed Markdown patch
```

## Established contracts

### ProjectProfile v1

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable surface IDs. Baseline ecosystems: Node, Python, Rust, Go. Explicit nested `.demoweave/config.json` roots own their loose research/notebook surfaces without hiding nested repository facts from a parent profile.

### Flow v1

Platform-neutral semantic actions (`run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, `capture`) plus optional explicit source dependencies. M11 adds optional `capture.artifact.path` for project-local native output files; UI `target` and native `artifact` are mutually exclusive. Runtime browser configuration, environment inference, and presentation metadata do not belong in Flow.

### Evidence v1 / Manifest v1

Typed artifact lifecycle, producer, provenance, source/Flow/artifact fingerprints, derivation relationships, and project indexing. Baseline formats now include IPYNB alongside image/video/text/data formats.

### TerminalTrack v1

Renderer-independent terminal capture: dimensions, command metadata, ordered input/stdout/stderr, ANSI-preserving output, process lifecycle, exit result, and duration.

### DocumentPlan v1

Hash-bound Markdown operations (`preserve`, direct-body `edit`, subtree `replace`, anchored `create`, reasoned `remove`) with exact preview, unified diff, review token, and atomic apply.

### FreshnessReport v1

Evidence classification (`fresh`, `stale`, `missing`, `unknown`), explicit reason chains, impacted Markdown, and the currently supported minimal regeneration actions. The generic `run-flow` regeneration path now covers research/notebook Flows as well as terminal/web sources.

### TimelinePlan v1

Presentation-only single/split scenes with explicit canvas/FPS/background, padding/gap/ratio, `contain`/`cover`, root Evidence/file sources, and MP4/GIF output.

### TutorialPlan v1

Agent-authored title/description/language/tags, caption timing/text, chapter timing/titles, and thumbnail treatment bound to existing MP4 Evidence.

### VisualQAPacket / VisualQAReport v1

Deterministic sample frames/contact sheet/timing/context/signals from **fresh** PNG/GIF/MP4 Evidence plus a durable agent-authored PASS/NEEDS-CHANGES report bound to exact packet/source hashes.

---

# Completed milestones

## M0 — Repository bootstrap ✅

TypeScript/pnpm workspace, core/CLI/drivers/renderer boundaries, CI, MIT license, shared agent skill.

## M1 — Project analyzer ✅

Ecosystem-neutral component/workspace model; Node/Python/Rust/Go baseline manifests; deterministic multi-surface ProjectProfile.

## M2 — Flow / Evidence / Manifest ✅

Flow v1, Evidence v1, Manifest v1, SurfaceDriver v1, synchronized schemas, normalization/cross-file validation.

## M3 — Terminal driver ✅

Non-interactive Windows/Linux terminal execution, assertions/waits/timeouts, expected non-zero exits, TerminalTrack capture, provenance-backed Evidence.

## M4 — Lightweight media renderer ✅

Terminal replay separated from presentation/encoding, safe ANSI handling, SVG/resvg PNG, FFmpeg GIF, derived Evidence, committed dogfood assets.

## P0 — DemoWeave documents DemoWeave ✅

Shared skill guided Codex through the real repository; README embeds real DemoWeave-generated runtime media and accurately separates current/planned capabilities.

## M5 — Safe Markdown patching ✅

Parser-backed source positions, byte-preserving original-source splicing, duplicate/nested heading safety, CR/LF/BOM hardening, review token, path/symlink safety, atomic apply/discard.

## M6 — Incremental stale tracking ✅

Flow/source/artifact fingerprints, explainable freshness, upstream propagation, impacted Markdown, dry-run/selective update, terminal/web no-churn dogfood.

## M7 — Web driver (Playwright) ✅

Semantic browser Flow actions, deterministic Chromium context, runtime `--base-url`/`--headed`, PNG screenshot Evidence, browser readiness diagnostics, Ubuntu/Windows smoke coverage.

M7 intentionally does not auto-start arbitrary apps or record browser interaction video/GIF.

## P1 — Controlled web fixture ✅

Standalone Next.js fixture, committed semantic Flow, real screenshot Evidence, M5-reviewed README, stale source/document impact, selective web regeneration, zero-churn second update.

## M8 — Timeline compositor ✅

- `TimelinePlan v1` under `.demoweave/timelines/`
- single/horizontal split layouts
- deterministic canvas/FPS/background/padding/gap/ratio
- `contain` and center-cropped `cover`
- safe root Evidence and project-relative PNG/GIF inputs
- static PNG + animated GIF behavior preserved honestly
- MP4/GIF output through FFmpeg argument arrays (`shell: false`)
- compositor Evidence + provenance/freshness propagation
- committed `terminal-web-proof` dogfood: animated terminal + static P1 browser screenshot
- Windows path/junction hardening + hosted cross-platform smoke

The browser pane is a screenshot; M8 does not claim browser recording.

## M9 — Tutorial output ✅

M9 packages existing verified MP4 Evidence without inventing a new recording or hiding an authoring model.

Delivered:

- `TutorialPlan v1` under `.demoweave/tutorials/`
- project-local MP4 Evidence resolution with traversal/symlink safety
- ffprobe dimensions/duration + plan timing validation
- source/output Evidence-ID collision protection
- real-frame FFmpeg thumbnail extraction
- SVG/resvg deterministic thumbnail title treatment
- byte-preserved package MP4
- SRT + WebVTT captions
- chapter text + description-with-chapters
- YouTube-oriented JSON metadata (no upload API call)
- all outputs as `renderer/tutorial` derived Evidence
- TutorialPlan fingerprints + freshness propagation
- `demoweave tutorial build`
- real CI dogfood on Ubuntu/Windows
- visual thumbnail review; `cover` was changed to `contain` to preserve the full wide split proof
- ffprobe doctor detection hardening

M9 intentionally does not synthesize narration/TTS, publish/upload, record browser interaction, or perform hidden visual review.

## M10 — Visual QA ✅

M10 makes visual review reproducible without pretending deterministic media analysis replaces agent judgment.

Delivered:

- `VisualQAPacket v1` generated from fresh PNG/GIF/MP4 Evidence
- exact source hash/dimensions/duration
- deterministic uniform sample frames + contact sheet
- optional Timeline/Tutorial context
- advisory black/freeze signals
- durable `VisualQAReport v1` with PASS/NEEDS-CHANGES findings
- exact packet/source/sample/contact-sheet hash binding at finalization
- source freshness checks both before prepare and before finalize
- PASS as derived `agent/visual-qa` Evidence; NEEDS-CHANGES as a failing gate
- freshness propagation into finalized reviews
- generated review cache separated from durable report metadata
- real seven-sample `terminal-web-proof-mp4` dogfood review
- intentional ~2.65–5.0s reading hold recorded as informational rather than auto-failed
- CI pins the exact visually reviewed source hash, so changed media requires an explicit new review
- review-packet upload remains available even when that approval hash is stale, allowing the next review to happen without weakening the gate
- Ubuntu/Windows tests/smokes; Linux real finalized review gate

M10 does not make OCR/secret-scanning guarantees, call a hidden vision model, auto-fix media, or fabricate browser recording.

## M11 — Research / notebook driver ✅

M11 makes native experiment outputs first-class Evidence and keeps notebook/application chrome out of the path unless the UI itself is what needs documenting.

Delivered:

- `ResearchDriver` implementing `SurfaceDriver v1` for both `research` and `notebook`
- existing Flow `run`, `wait`, `assert`, and `capture` semantics reused; no research-only automation language
- backwards-compatible optional `capture.artifact.path` in Flow v1
- native artifact snapshot into `.demoweave/evidence/artifacts/`
- baseline PNG/JPEG/WebP/SVG/GIF/WebM/MP4/JSON/CSV/TXT/MD/HTML/IPYNB formats
- semantic Evidence kinds such as `plot`, `table`, `result`, `image`, and `recording`
- `driver/research` producer metadata + artifact/Flow/material-source fingerprints
- transient generated output paths kept out of source provenance
- project traversal and symlink-escape protection
- no environment/Jupyter/Python installation or guessing
- explicit notebook execution command model: a repository chooses `jupyter`, `uv`, `python`, `poetry`, R, Julia, MATLAB, another binary, etc.
- a dependency-free fixture-local notebook executor only for cross-platform contract testing; it is not a Jupyter implementation
- nested initialized DemoWeave project ownership boundary for loose research/notebook surface detection without hiding nested manifest/source facts
- published Flow/Evidence JSON Schema parity tests for native artifact capture + IPYNB
- `fixtures/research` with two real detected surfaces:
  - `research-research-workflow`
  - `notebook-notebooks`
- fixture produces/captures:
  - SVG learning-curve plot
  - CSV benchmark table
  - JSON metrics result
  - executed IPYNB with real captured cell stdout
- immutable Evidence remains fresh after the transient `outputs/` directory is deleted
- controlled source mutation stales exactly the three research outputs, not the notebook
- generic M6 update computes exactly one `run-flow research-results` repair
- second update performs zero actions with byte-identical Evidence/manifest
- hosted Ubuntu/Windows build/tests/typecheck + full M11 smoke

M11 does not screen-record notebook UI, infer a scientific environment, or turn generated output paths into fake source dependencies.

---

# Next milestones

## M12 — Desktop drivers

M12 is in progress. Capture priority remains semantic/application-native → window-specific OS capture → region capture → display capture, with no OBS requirement.

Delivered:

- M12A: portable `DesktopDriver → DesktopBackend v1` lifecycle, capability probing, explicit unsupported-host diagnostics, and normal screenshot Evidence ownership;
- M12B: Windows-only `WindowsUiaBackend` attached to an explicit already-running `--desktop-pid`;
- PID-anchored, single-window UIA subtree lookup with explicit missing/ambiguous diagnostics;
- semantic AutomationId/accessible Name/ControlType targets, `InvokePattern`, `ValuePattern`, explicit key presses, bounded waits/assertions;
- native top-level application-window PNG capture through `PrintWindow`;
- normal Flow/source/artifact provenance, selective `update --apply --desktop-pid`, and zero-action/no-churn proof;
- a committed native WinForms fixture and visually inspected window-only screenshot Evidence.

Remaining M12 slices:

- macOS native backend;
- Linux native backend;
- any Electron-specific backend beyond what is factually exposed through a proven native adapter;
- element capture and robust semantic scrolling where a backend can implement them without coordinate fallbacks.

Flow v1 remains platform-neutral. DemoWeave does not infer or launch executables, store runtime PIDs in metadata, choose ambiguous windows, capture the full display, or claim generic cross-platform desktop support.

## M13 — Mobile drivers

The Android slice is implemented and proven through the portable `MobileDriver → MobileBackend v1` boundary.

Delivered:

- invocation-only `--mobile-platform android` and optional `--mobile-device-id <serial>` for `run` and selective `update --apply`;
- launcher-only native Android detection from owned `src/main/AndroidManifest.xml` files;
- semantic UIAutomator mappings for resource ID, content description, text/name, and explicit widget roles;
- ADB activation, conservative replacement input, explicit keys, semantic scroll translation, bounded waits/assertions, and full-device PNG capture;
- `mobile/android-adb` Evidence with normal Flow/source/artifact fingerprints and no persisted serial;
- a deterministic Java/XML fixture, real API 36 emulator screenshot, visual review, source-stale repair, and zero-action/no-churn proof;
- hosted Ubuntu/Windows protocol tests with injected ADB runners rather than a manufactured emulator claim.

Remaining mobile work:

- iOS backend and real macOS/Xcode proof;
- element capture, mobile screen recording/video, arbitrary gestures/multi-touch, and app launching remain intentionally unsupported.

Flow v1 remains platform-neutral; device serials, ADB commands, package/activity launch details, and coordinates do not belong in Flow or persistent metadata.

## M14 — Plugin/driver SDK ✅

M14 establishes the trusted plugin host without changing Flow v1 or opening ProjectProfile v1 to arbitrary values.

Delivered:

- workspace-only `@demoweave/sdk` with plugin API v1 and `definePlugin`;
- explicit ordered `.demoweave/config.json` plugin configuration with no discovery or installation;
- project-root-safe local ESM loading and target-project package resolution;
- closed deterministic registration with detector, per-Flow driver-factory, and renderer contributions;
- additive schema-validated surfaces/framework facts in normal `inspect`;
- plugin drivers in normal `run` and selective `update --apply`, with ambiguity failures instead of built-in overrides;
- renderer declarations for accepted Evidence kinds/formats and output formats;
- stable renderer IDs (`terminal` and `plugin/<plugin-id>/<renderer-id>`) with exact selection and explicit ambiguity/unsupported diagnostics;
- detached/read-only renderer inputs and runtime validation of JavaScript result shape, format, kind, MIME, data, and label before mutation;
- host-owned safe output paths, atomic writes, deterministic derived Evidence IDs, Manifest normalization, artifact hashes, producer identity, plugin fingerprints, `derivedFrom`, and portable provenance;
- generalized backwards-compatible `render-evidence` regeneration across EvidenceFormat v1 with optional exact plugin renderer IDs;
- plugin-changed/source-upstream selective renderer repair, plugin-unavailable unknown/zero-action behavior, and second-update byte-identical no-churn proof;
- `plugins list` and `plugins doctor` renderer reporting;
- real external-style JSON result → deterministic SVG card fixture plus built-in/plugin ambiguity proof;
- Windows/Linux-oriented security, lifecycle, validation, freshness, selective-repair, and no-churn tests.

Plugins are trusted Node.js code with CLI process privileges; DemoWeave does not sandbox them. `@demoweave/sdk` remains source-workspace-only and is not claimed as an npm publication.

M14 does not add plugin installation/discovery, publisher/upload behavior, renderer-specific Flow syntax, or unsupported platform claims. Publishers remain M15 work.

## M15 — Documentation publishers 🚧 Current

Define and implement factual publisher integrations that complement rather than replace existing stacks: plain Markdown/GitHub, Fumadocs, Mintlify, Docusaurus, VitePress, MkDocs, and similar targets. M14 intentionally contains no publisher/upload runtime.

---

# 1.0 target

DemoWeave 1.0 should provide stable agent workflows/contracts, multi-surface analysis, terminal + web + research/notebook + process/library support, evidence-backed screenshot/GIF/video/native-result presentation where supported, arbitrary Markdown review/apply, incremental stale tracking, lightweight composition, tutorial packaging, reproducible agent visual QA, and extension paths for desktop/mobile/ecosystem integrations.

## Development order

| Order | Milestone | Demo value |
|---|---|---|
| 1 | ✅ M0 — scaffold | real project skeleton |
| 2 | ✅ M1 — analyzer | understands repositories |
| 3 | ✅ M2 — Flow/Evidence/Manifest | stable internal contracts |
| 4 | ✅ M3 — terminal driver | DemoWeave runs itself |
| 5 | ✅ M4 — GIF renderer | first visual artifact |
| 6 | ✅ P0 — self-document README | first public-quality dogfood demo |
| 7 | ✅ M5 — safe Markdown patching | reliable reviewed document edits |
| 8 | ✅ M6 — stale tracking | living documentation |
| 9 | ✅ M7 — web driver | browser execution + screenshot Evidence |
| 10 | ✅ P1 — web fixture | second-surface public proof |
| 11 | ✅ M8 — compositor | independent evidence → polished scenes |
| 12 | ✅ M9 — tutorial output | MP4 Evidence → upload-oriented package |
| 13 | ✅ M10 — visual QA | reproducible agent review gate |
| 14 | ✅ M11 — research/notebook | native research results + notebook Evidence |
| 15 | 🚧 M12 — desktop | Windows available; macOS/Linux deferred |
| 16 | 🚧 M13 — mobile | Android available; iOS planned |
| 17 | ✅ M14 — plugin SDK | trusted detectors, drivers, and renderer plugins |
| 18 | **🚧 M15 — publishers** | **documentation publishing integrations** |
| 19 | 1.0 hardening | public stable release |

## Current next step

Define the M15 publisher contract before adding runtime integrations. Preserve M14's explicit trusted-plugin model, host-owned Evidence/provenance boundaries, and no-discovery/no-installation behavior; iOS and macOS/Linux desktop backends remain separate work.
