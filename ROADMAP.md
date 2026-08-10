# DemoWeave Roadmap

DemoWeave is an agent-native documentation studio for software repositories. Claude Code or Codex supplies the reasoning; DemoWeave supplies deterministic project inspection, workflow execution, evidence capture, rendering, freshness analysis, document patching, validation, and provenance.

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
| **M8 — Timeline compositor** | **🚧 Current** | Compose independent Evidence/media into polished deterministic scenes without OBS |

M0/M1 landed in PR #1, M2 in PR #2, M3 in PR #3, M4 in PR #4, Pilot P0 in PR #5, M5 in PR #6, M6 in PR #7, M7 in PR #8, M5 hardening in PR #9, and Pilot P1 in PR #10.

## Product principles

- **Agent supplies intelligence; DemoWeave supplies deterministic tooling.**
- **Multi-surface by design.** Never collapse a repository into one `projectType`.
- **Evidence over decoration.** Visuals must explain or prove something useful.
- **Preserve good existing documentation.** Patch intentionally instead of regenerating blindly.
- **README.md and arbitrary Markdown are first-class targets.** `/docs` is not special.
- **No OBS requirement.** Capture the smallest useful surface directly and compose later.
- **One source of truth for demos.** Structured Flows feed evidence, docs, and later animated/tutorial outputs.
- **Incremental by default.** Provenance should make stale evidence selectively regenerable.
- **Unknown is not stale.** When a deterministic baseline is unavailable, report uncertainty instead of inventing a conclusion.
- **Capture and presentation are separate.** Runtime timestamps and source artifacts remain factual; renderers/compositors may derive presentation timing without rewriting evidence.
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
  ↓
optional renderer
  └─ terminal → PNG / GIF
  ↓
FreshnessReport v1
  ↓
minimal selective update
  ↓
DocumentPlan v1
  ↓
reviewed Markdown patch
```

P0 proved the terminal path by making DemoWeave's own README use DemoWeave-generated media. M5 added reviewed document editing. M6 closed the freshness loop. M7 added Chromium as a second execution surface without changing Flow v1. P1 then proved the complete browser screenshot → documentation → stale source → impacted document → selective regeneration → no-churn loop on a committed standalone fixture.

## Established contracts

### ProjectProfile v1

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable surface IDs. Baseline ecosystems: Node (`package.json`), Python (`pyproject.toml`), Rust (`Cargo.toml`), and Go (`go.mod`).

### Flow v1

Platform-neutral semantic steps such as `run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture`. Terminal run steps may declare `expectedExitCodes`; omission means `[0]`. Flows may also declare project-relative source dependencies that materially determine their captured result.

Raw Playwright selectors, browser launch flags, origins, application-start commands, recorder commands, and renderer/compositor details do not belong in Flow v1.

### Evidence v1 / Manifest v1

Evidence records lifecycle, artifact metadata, producer, provenance, optional SHA-256 source/Flow/artifact fingerprints, and derivation. Manifest v1 indexes Flows and Evidence and preserves source/derived relationships. Current source Evidence includes terminal tracks and web PNG screenshots; terminal PNG/GIF outputs are derived Evidence.

### TerminalTrack v1

Renderer-independent terminal capture with dimensions, portable command/cwd metadata, ordered input/stdout/stderr events, ANSI-preserving output, process lifecycle, exit code/signal, and duration.

### DocumentPlan v1

Agent-authored, deterministic Markdown change plans bound to an exact target content hash. Plans select inspected sections and declare `preserve`, `edit`, `replace`, `create`, or reasoned `remove` operations. Preview produces the complete candidate, unified diff, and review token; apply requires that exact reviewed token and refuses stale targets or changed plans.

### FreshnessReport v1

Deterministic freshness output for Evidence and document impact. Evidence is classified as `fresh`, `stale`, `missing`, or `unknown` with explicit reason codes. The report also contains impacted Markdown and the currently supported minimal regeneration plan.

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

---

# Current milestone

## M8 — Timeline compositor 🚧

**Goal:** compose independent DemoWeave Evidence/media sources into polished deterministic scenes without recording the desktop and without coupling capture logic to presentation logic.

The first M8 vertical slice should prove composition using artifacts DemoWeave already knows how to produce. A strong dogfood scene is an animated terminal source beside the static P1 browser screenshot: motion comes from the terminal presentation, while the browser pane remains explicitly a screenshot rather than pretending to be a browser recording.

### M8 architectural requirements

```text
Evidence / media sources
        ↓
Timeline / Scene plan
        ↓
source decoders / presentation tracks
        ↓
layout + crop/fit/scale + overlays
        ↓
deterministic frames
        ↓
FFmpeg encoder
        ↓
composed GIF / MP4 Evidence
```

- Keep **capture**, **presentation**, and **composition** separate.
- No OBS, Electron, desktop recording, or Chromium just to composite existing assets.
- Reference existing Evidence IDs where possible rather than arbitrary untracked files.
- Preserve source provenance through `derivedFrom` relationships.
- Do not mutate source Evidence.
- The compositor must be deterministic given the same inputs and plan, apart from documented encoder/platform limits.
- Use one controlled canvas with explicit output dimensions and frame rate.
- Start with useful layouts: single-source and two-pane split.
- Support predictable fit/contain/cover/crop behavior without silently distorting sources.
- Support simple text/title overlays only where they materially help a scene.
- Keep transitions minimal and deterministic; a hard cut and one simple fade are enough initially.
- Audio plumbing may be represented internally if it does not complicate the slice, but narration/TTS belongs to M9.
- Do **not** claim browser interaction video. A static browser screenshot inside a composed video is still a static browser screenshot.

### M8 contract direction

M8 may introduce a small internal/published `Timeline` or `ScenePlan` contract if needed. It should describe presentation and composition, not surface automation. Do not put layout/timeline fields into Flow v1.

A plan should be able to express, at minimum:

- output canvas width/height and frame rate
- total duration or scene durations
- source reference by Evidence ID
- source start/end/presentation window where meaningful
- one-pane or split layout
- fit/crop policy
- optional title/text overlay
- simple scene ordering/transition

Avoid designing the full M9 tutorial language in advance.

### M8 first dogfood target

Produce a short polished composition from existing real DemoWeave artifacts, for example:

```text
┌──────────────────────────────┬──────────────────────────────┐
│                              │                              │
│  animated terminal evidence  │   P1 browser screenshot     │
│                              │                              │
└──────────────────────────────┴──────────────────────────────┘
```

A concise title may identify what is being shown. The output should demonstrate that independent evidence tracks can be composed without capturing a literal desktop.

### M8 acceptance criteria

1. Composition plan is separate from Flow v1 and source Evidence.
2. Existing terminal Evidence/media and image/screenshot Evidence can be resolved safely by Evidence ID.
3. At least one deterministic single-source layout and one deterministic split layout work.
4. Sources preserve aspect ratio with explicit fit/crop semantics.
5. Rendering is headless and requires no browser/OBS for composition.
6. FFmpeg is invoked through argument arrays, not shell command strings.
7. Missing/invalid Evidence and unsupported formats fail structurally.
8. Temporary frames/intermediates are cleaned up on success and failure.
9. A composed output is recorded as derived Evidence with all source Evidence in `derivedFrom`.
10. Source/plan/artifact fingerprints are sufficient for later freshness integration without inventing dependencies.
11. A real committed dogfood composition is generated from DemoWeave's existing terminal + P1 browser artifacts.
12. The dogfood output is visually reviewed for readability, clipping, aspect ratio, pacing, and file size.
13. Same-input composition is semantically deterministic; repeated no-change generation does not create unexplained manifest churn.
14. Ubuntu and Windows hosted CI exercise the core compositor path.
15. Browser recording, narration, chapters, full tutorial authoring, and visual-QA automation remain explicitly out of scope.

---

# Later milestones

## M9 — Full tutorial output

Generate YouTube-ready MP4, thumbnail, captions, chapters, title, and description. Narration/TTS remains an optional adapter. Browser recording input should be added deliberately before any tutorial claims depend on browser motion.

## M10 — Visual QA

Agent-review sampled frames for readability, secrets, clipping, broken/loading states, dead time, and narration/visual mismatch. Structured beats should allow partial re-recording.

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
| 11 | **🚧 M8 — compositor** | independent evidence → polished scenes |
| 12 | M9/M10 — tutorial + QA | YouTube-ready output |
| 13 | M11 — research/notebook | research repos |
| 14 | M12 — desktop | native apps |
| 15 | M13 — mobile | Android/iOS |
| 16 | M14/M15 — ecosystem | plugins/publishers |
| 17 | 1.0 hardening | public stable release |

---

# Current next step

## NOW: M8 — timeline compositor

Build the smallest composition layer that can take existing DemoWeave Evidence/media, place it on a controlled timeline/canvas, and render a polished single/split scene without OBS or desktop capture. Dogfood it by combining the existing terminal presentation with the P1 web screenshot, preserve derivation/provenance, and stop before tutorial/narration/browser-recording work.
