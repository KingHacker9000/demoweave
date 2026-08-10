# DemoWeave Roadmap

DemoWeave is an agent-native documentation studio for software repositories. Claude Code or Codex supplies the reasoning; DemoWeave supplies deterministic project inspection, workflow execution, evidence capture, rendering, composition, tutorial packaging, freshness analysis, document patching, validation, and provenance.

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
| P1 — Web fixture pilot | ✅ Complete | Committed browser Evidence + reviewed docs + stale/selective-regeneration proof |
| M8 — Timeline compositor | ✅ Complete | `TimelinePlan v1`; local Evidence/media → deterministic split/single MP4/GIF without OBS |
| **M9 — Tutorial output** | **🚧 Current** | Package existing MP4 Evidence into video + thumbnail + captions + chapters + upload metadata |

M0/M1 landed in PR #1, M2 in PR #2, M3 in PR #3, M4 in PR #4, Pilot P0 in PR #5, M5 in PR #6, M6 in PR #7, M7 in PR #8, M5 hardening in PR #9, Pilot P1 in PR #10, and M8 in PR #11. M9 is being developed in draft PR #12.

## Product principles

- **Agent supplies intelligence; DemoWeave supplies deterministic tooling.**
- **Multi-surface by design.** Never collapse a repository into one `projectType`.
- **Evidence over decoration.** Visuals must explain or prove something useful.
- **Preserve good existing documentation.** Patch intentionally instead of regenerating blindly.
- **README.md and arbitrary Markdown are first-class targets.** `/docs` is not special.
- **No OBS requirement.** Capture the smallest useful surface directly and compose later.
- **One source of truth for demos.** Structured Flows feed evidence, docs, composition, and tutorial outputs.
- **Incremental by default.** Provenance should make stale evidence selectively regenerable.
- **Unknown is not stale.** When a deterministic baseline is unavailable, report uncertainty instead of inventing a conclusion.
- **Capture and presentation are separate.** Runtime artifacts stay factual; renderers/compositors/tutorial packagers derive presentation without rewriting what happened.
- **Agent-authored narrative stays agent-authored.** DemoWeave validates/packages captions, chapters, titles, and descriptions; it does not secretly invoke an LLM.
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
  └─ web/Playwright → screenshot Evidence
  ↓
Evidence v1 + Manifest v1 + fingerprints
  ├─ terminal renderer → PNG / GIF
  └─ TimelinePlan v1 → composed MP4 / GIF
                         ↓
                    TutorialPlan v1
                         ↓
          MP4 + thumbnail + SRT/VTT
          + chapters + description + metadata
  ↓
FreshnessReport v1
  ↓
minimal selective update where supported
  ↓
DocumentPlan v1
  ↓
reviewed Markdown patch
```

P0 proved the terminal path by making DemoWeave's own README use DemoWeave-generated media. M5 added reviewed document editing. M6 closed the freshness loop. M7 added Chromium as a second execution surface without changing Flow v1. P1 proved the browser screenshot → documentation → stale source → impacted document → selective regeneration → no-churn loop. M8 then proved that independent terminal/browser artifacts can be composed into polished media without recording a literal desktop or requiring OBS.

## Established contracts

### ProjectProfile v1

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable surface IDs. Baseline ecosystems: Node (`package.json`), Python (`pyproject.toml`), Rust (`Cargo.toml`), and Go (`go.mod`).

### Flow v1

Platform-neutral semantic steps such as `run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture`. Terminal run steps may declare `expectedExitCodes`; omission means `[0]`. Flows may also declare project-relative source dependencies that materially determine their captured result.

Raw Playwright selectors, browser launch flags, origins, application-start commands, recorder commands, renderer/compositor details, timeline layout, and tutorial metadata do not belong in Flow v1.

### Evidence v1 / Manifest v1

Evidence records lifecycle, artifact metadata, producer, provenance, optional SHA-256 source/Flow/artifact fingerprints, and derivation. Manifest v1 indexes Flows and Evidence and preserves source/derived relationships. Current source Evidence includes terminal tracks and web PNG screenshots; renderers/compositors/tutorial packaging add derived image/recording/text/result Evidence.

### TerminalTrack v1

Renderer-independent terminal capture with dimensions, portable command/cwd metadata, ordered input/stdout/stderr events, ANSI-preserving output, process lifecycle, exit code/signal, and duration.

### DocumentPlan v1

Agent-authored, deterministic Markdown change plans bound to an exact target content hash. Plans select inspected sections and declare `preserve`, `edit`, `replace`, `create`, or reasoned `remove` operations. Preview produces the complete candidate, unified diff, and review token; apply requires that exact reviewed token and refuses stale targets or changed plans.

### FreshnessReport v1

Deterministic freshness output for Evidence and document impact. Evidence is classified as `fresh`, `stale`, `missing`, or `unknown` with explicit reason codes. The report also contains impacted Markdown and the currently supported minimal regeneration plan. Derived compositor/tutorial outputs participate in freshness propagation even when no automatic rebuild action exists yet.

### TimelinePlan v1

Presentation-only composition contract. A timeline has an explicit canvas, FPS/background, ordered cut scenes, single/horizontal-split layouts, pane sources, padding/gap/ratio, and `contain`/`cover` fit. Sources are root Evidence IDs or safe project-relative PNG/GIF files. Raw FFmpeg filters are not part of the plan.

### TutorialPlan v1

Current M9 contract for packaging existing MP4 Evidence. The agent supplies title/description/language/tags, explicit caption text/timing, chapters, and thumbnail presentation. DemoWeave validates project-local source Evidence and timing, then packages deterministic sidecars. TutorialPlan does not automate a surface and does not belong in Flow v1.

---

# Completed milestones

## M0 — Repository bootstrap ✅

- TypeScript + pnpm workspace
- `@demoweave/core`, `@demoweave/cli`, `@demoweave/drivers`, `@demoweave/renderer`
- CLI binary `demoweave`
- build/test/typecheck CI
- MIT license
- shared `skills/demoweave/SKILL.md`

## M1 — Project analyzer ✅

- ecosystem-neutral component/workspace model
- Node, Python, Rust, Go baseline manifest analysis
- deterministic stable surface IDs
- `doctor`, `init`, `inspect`, `status`, `validate`

## M2 — Flow / Evidence / Manifest ✅

- Flow v1
- Evidence v1
- Manifest v1
- SurfaceDriver v1
- synchronized JSON Schemas
- deterministic manifest normalization + cross-file validation

## M3 — Terminal driver ✅

- `TerminalDriver → TerminalSession → ProcessTerminalSession`
- Windows + Linux/WSL non-interactive execution
- assertions, waits, timeouts, expected non-zero exits
- `demoweave run <flow-id-or-path>`
- TerminalTrack v1
- atomic Evidence/Manifest writes with provenance
- committed self-dogfood Flow

## M4 — Lightweight media renderer ✅

- renderer-independent terminal replay/presentation/encoding separation
- safe current pipe-mode ANSI/control handling
- SVG terminal presentation + headless `resvg` PNG
- optional FFmpeg two-pass GIF encoding
- `demoweave render <evidence-id-or-path> --format png|gif`
- derived Evidence + provenance
- committed 1020×486 self-inspection PNG/GIF
- Windows + Ubuntu render smoke tests

## P0 — DemoWeave documents DemoWeave ✅

- Codex followed `skills/demoweave/SKILL.md` without a hidden DemoWeave-specific workflow.
- The repo was inspected and validated using the real built CLI.
- The committed self Flow executed successfully and refreshed TerminalTrack provenance.
- PNG/GIF were regenerated from evidence; same-input rendering was byte-stable.
- The README embeds the real generated GIF near the top with accurate context.
- Current vs planned features are clearly separated.
- Hosted Ubuntu + Windows CI passed on the P0 head.

## M5 — Document planning + safe Markdown patching ✅

Agents can inspect arbitrary Markdown, declare intentional section-level changes, preview the exact candidate and diff, obtain a deterministic review fingerprint, and atomically apply only the reviewed patch without rewriting untouched content.

Delivered:

- maintained mdast parser source positions; original-source splicing rather than Markdown reserialization
- preamble support, nested paths, duplicate-safe section IDs, fenced-code awareness
- byte-preserving untouched ranges including UTF-8 BOM handling and LF/CRLF/CR-only consistency
- DocumentPlan v1 runtime validation + published JSON Schema
- `preserve`, direct-body `edit`, whole-subtree `replace`, anchored `create`, and reasoned `remove`
- overlap/preserve/selector/path/symlink safety checks
- maintained unified diff + deterministic `review-v1` token
- stale target/changed plan/candidate rejection
- same-directory atomic apply with permission preservation
- safe plan discard
- `demoweave docs inspect|preview|apply|discard`
- shared Claude/Codex skill using inspect → plan → preview → approval → apply
- Ubuntu + Windows dogfood and hardening coverage

## M6 — Incremental stale/update tracking ✅

DemoWeave can explain why existing Evidence is fresh/stale/missing/unknown, trace that state through rendered derivations into Markdown references, and compute a minimal deterministic regeneration plan before changing anything.

Delivered:

- optional explicit `sources` on Flow v1
- SHA-256 Flow/source/artifact fingerprints
- backward-compatible Evidence source provenance + git fallback for older Evidence
- `unknown` instead of guessed freshness when a baseline cannot be reached
- stale/missing/unknown reason codes and recursive upstream propagation
- Markdown impact detection
- `FreshnessReport v1`
- `demoweave status` and dry-run/selective `demoweave update`
- terminal self-dogfood proving one Flow + two renders repair a stale chain followed by zero-action/zero-churn update
- P1 runtime-context passthrough for web regeneration via invocation-scoped `--base-url` / `--headed`
- hosted Ubuntu + Windows coverage

## M7 — Web driver (Playwright) ✅

DemoWeave can execute the existing semantic Flow v1 against a browser surface and capture screenshot Evidence without adding Playwright-specific operations to the shared contracts.

Delivered:

- `WebDriver` implementing `SurfaceDriver v1` for `web`
- Playwright Chromium runtime pinned in the workspace lockfile
- deterministic browser context: viewport/device scale, locale, UTC timezone, light scheme, reduced motion, blocked service workers
- semantic target mapping for `text`, `label`, `role`, `name`, `testId`, `accessibilityId`, `automationId`
- semantic navigate/activate/input/press/scroll, supported waits/assertions
- relative navigation through runtime `--base-url`; optional `--headed`
- HTTP navigation diagnostics
- viewport/element PNG screenshot capture with animation/caret suppression
- atomic screenshot Evidence + driver/web provenance + M6 fingerprints
- Playwright readiness in `doctor`
- local + hosted browser smoke coverage on Ubuntu and Windows

M7 intentionally does **not** auto-start arbitrary applications or implement browser video/GIF recording.

## P1 — Controlled web fixture ✅

P1 made `fixtures/web` a standalone deterministic Next.js project and used the public DemoWeave workflow against it rather than relying on an ephemeral test page.

Delivered:

- standalone npm/lockfile-backed fixture with explicit production build/start commands
- polished deterministic 1280×720 project dashboard with semantic controls and no external assets
- detected surface `web-fixture-web` / Next.js
- committed semantic `create-project` Flow with only material UI implementation files declared as sources
- real `driver/web` screenshot Evidence `create-project-result`
- concise fixture README that embeds the captured artifact
- README change created through the M5 inspect → DocumentPlan → preview/review token → apply workflow
- fresh baseline proven before mutation
- controlled source mutation producing an exact `source-changed` reason and `README.md` document impact
- minimal regeneration containing exactly one web Flow run
- invocation-scoped `update --apply --base-url ...` integration for relative web navigation
- selective screenshot repair while README prose remains untouched
- second update with zero actions and zero tracked-byte churn
- committed cross-platform P1 smoke using a disposable copy of the real fixture
- hosted Ubuntu + Windows validation

P1 remains screenshot-only. Browser interaction recording was not fabricated or implied.

## M8 — Timeline compositor ✅

M8 proved that presentation can sit above source capture: independent terminal/browser artifacts are composed without recording a desktop, requiring OBS, or leaking FFmpeg syntax into Flow v1.

Delivered:

- published `TimelinePlan v1` under `.demoweave/timelines/`
- explicit canvas width/height/FPS/background and ordered cut scenes
- deterministic single and horizontal split layouts with padding/gap/ratio
- `contain` and center-cropped `cover` with no aspect-ratio distortion
- root Evidence sources plus safe project-relative PNG/GIF file sources
- traversal/absolute-path/symlink-escape protection and media-byte validation
- static PNG looping and real animated GIF playback
- FFmpeg composition through argument arrays with `shell: false`
- MP4 and GIF output
- composed `renderer/compositor` Evidence with source/plan/artifact fingerprints and root source IDs in `derivedFrom`
- freshness propagation without inventing unsupported compose regeneration actions
- real dogfood `terminal-web-proof`: animated terminal Evidence beside the static P1 browser screenshot
- committed 1920×720, 5-second, 20-fps MP4/GIF proof
- visual review for readability, clipping, aspect ratio, pacing, flicker, final frame, and file size
- same-input no-churn proof
- Windows-path/junction hardening
- hosted Ubuntu + Windows compositor smoke coverage

The browser pane in that composition remains a screenshot. M8 did not add browser recording.

---

# Current milestone

## M9 — Tutorial output 🚧

**Goal:** turn an existing verified MP4 Evidence source into an upload-oriented tutorial package while preserving the agent/tool boundary.

M9 is packaging, not a hidden authoring model. Claude Code/Codex (or another agent/user) chooses the narrative and writes exact titles/descriptions/captions/chapters. DemoWeave validates those choices against the real video, derives presentation artifacts, records provenance, and keeps the package reproducible.

### M9 pipeline

```text
existing MP4 Evidence
        +
agent-authored TutorialPlan v1
        ↓
project/path + timing validation
        ↓
FFmpeg frame extraction + ffprobe
        ↓
SVG/resvg thumbnail treatment
        +
SRT / WebVTT / chapters / description / metadata
        ↓
renderer/tutorial Evidence + provenance
```

### M9 current scope

- persistent `TutorialPlan v1` under `.demoweave/tutorials/`
- source by root-project MP4 Evidence ID
- title, description, language, optional tags
- explicit caption IDs/text/start/end timing
- explicit chapter titles/start timing
- thumbnail timestamp, size, fit/background, optional title/subtitle
- project-local source/output path safety
- FFmpeg + ffprobe capability checks
- real-frame thumbnail extraction
- deterministic SVG/resvg text treatment instead of FFmpeg system-font drawtext
- byte-preserved source MP4 in the package
- SRT + WebVTT caption sidecars
- chapter text + description-with-chapters
- YouTube-oriented JSON metadata file (no upload API call)
- all outputs recorded as `renderer/tutorial` Evidence derived from the source MP4
- TutorialPlan SHA-256 provenance for plan-dependent outputs
- existing freshness propagation with no automatic tutorial rebuild action yet

### M9 dogfood target

The checked-in `.demoweave/tutorials/demoweave-overview.json` uses the real M8 `terminal-web-proof-mp4` Evidence and should generate:

```text
docs-media/tutorials/demoweave-overview/
  demoweave-overview.mp4
  demoweave-overview-thumbnail.png
  demoweave-overview.srt
  demoweave-overview.vtt
  demoweave-overview-chapters.txt
  demoweave-overview-description.txt
  demoweave-overview-youtube.json
```

The source video currently contains animated terminal Evidence beside a static browser screenshot. M9 must describe that honestly. It must not call the browser pane recorded browser interaction.

### M9 acceptance criteria

1. `TutorialPlan v1` is separate from Flow v1 and TimelinePlan v1.
2. Source MP4 Evidence resolves safely inside the project; traversal, absolute paths, symlink escapes, missing Evidence, and wrong formats fail structurally.
3. Source Evidence IDs cannot collide with deterministic tutorial output Evidence IDs.
4. `ffprobe` validates positive video dimensions/duration; thumbnail/caption/chapter timing outside the source duration is rejected.
5. The thumbnail comes from a real source frame and is rendered headlessly with deterministic presentation semantics.
6. SRT and WebVTT timestamps/text are deterministic and derived exactly from agent-authored caption cues.
7. Chapter, description, and YouTube-oriented metadata files are deterministic and contain no invented prose beyond the TutorialPlan.
8. The package MP4 preserves the existing source-video bytes; M9 does not fabricate a new recording.
9. Every package file is represented as derived Evidence with artifact hash, `renderer/tutorial` producer metadata, source MP4 derivation, and TutorialPlan provenance where appropriate.
10. Existing freshness analysis detects changed source MP4, changed TutorialPlan, or changed output bytes without inventing unsupported automatic tutorial rebuild actions.
11. Same-input package generation produces no unexplained file/manifest churn on a single platform.
12. A real `demoweave-overview` dogfood package is generated from committed M8 Evidence and reviewed for thumbnail legibility, caption timing/content, chapters, description/metadata accuracy, dimensions, duration, and file size.
13. Hosted Ubuntu and Windows pass full build/tests/typecheck plus the real M9 package path.
14. README and shared `SKILL.md` describe tutorial packaging accurately and continue to state that browser recording, narration/TTS, publishing/upload integration, and M10 visual QA are unavailable.
15. M10 work is not started inside the M9 implementation PR.

---

# Later milestones

## M10 — Visual QA

Agent-review sampled frames for readability, secrets, clipping, broken/loading states, dead time, and narration/visual mismatch. Structured beats should allow partial re-recording. This should consume real renderer/compositor/tutorial outputs rather than introduce another capture stack.

## M11 — Research / notebook driver

Use real notebook/script outputs, plots, benchmark tables, generated images/videos, comparisons, and experiment artifacts rather than screenshots of notebook UI where possible.

## M12 — Desktop drivers

Electron, Windows, macOS, Linux. Capture priority: semantic/application-native → window-specific OS capture → region capture → display capture. No OBS requirement.

## M13 — Mobile drivers

Android/iOS adapters implementing the same semantic actions and Evidence contracts.

## M14 — Plugin/driver SDK

Third-party extension points for surface drivers, evidence producers, renderers, publishers, and detectors.

## M15 — Documentation publishers

Integrate rather than replace existing stacks: plain Markdown/GitHub, Fumadocs, Mintlify, Docusaurus, VitePress, MkDocs, etc.

---

# 1.0 target

DemoWeave 1.0 should provide stable agent workflows and contracts, multi-surface analysis, terminal + web + process/library support, screenshot/GIF/video evidence where the required capture/render paths exist, arbitrary Markdown support, safe patch/review, incremental stale tracking, lightweight media composition, tutorial output, and an extension path for desktop/mobile/research.

# Development order

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
| 9 | ✅ M7 — web driver | website execution + screenshot Evidence |
| 10 | ✅ P1 — web fixture | second-surface public proof |
| 11 | ✅ M8 — compositor | independent evidence → polished scenes |
| 12 | **🚧 M9 — tutorial output** | MP4 Evidence → upload-oriented package |
| 13 | M10 — visual QA | sampled-frame and presentation review |
| 14 | M11 — research/notebook | research repos |
| 15 | M12 — desktop | native apps |
| 16 | M13 — mobile | Android/iOS |
| 17 | M14/M15 — ecosystem | plugins/publishers |
| 18 | 1.0 hardening | public stable release |

---

# Current next step

## NOW: M9 — tutorial output

Finish the deterministic TutorialPlan package path around existing MP4 Evidence, prove it with the real `demoweave-overview` dogfood package, review the generated thumbnail/captions/chapters/metadata, keep narration/TTS/browser-recording/publishing explicitly out of scope, and stop before M10 automated visual QA.
