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
| **P1 — Web fixture pilot** | **🚧 Current** | Prove the public documentation workflow on a second surface |

M0/M1 landed in PR #1, M2 in PR #2, M3 in PR #3, M4 in PR #4, Pilot P0 in PR #5, M5 in PR #6, M6 in PR #7, and M7 in PR #8.

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
  ↓
PNG / GIF (currently terminal renderer)
  ↓
FreshnessReport v1
  ↓
minimal selective update
  ↓
DocumentPlan v1
  ↓
reviewed Markdown patch
```

P0 proved the terminal evidence path with DemoWeave itself. M5 added reviewed document editing. M6 closed the freshness loop. M7 proves that the same Flow/Evidence/Manifest/freshness contracts can drive a second surface—Chromium through Playwright—without introducing browser-specific instructions into Flow v1.

## Established contracts

### ProjectProfile v1

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable surface IDs. Baseline ecosystems: Node (`package.json`), Python (`pyproject.toml`), Rust (`Cargo.toml`), and Go (`go.mod`).

### Flow v1

Platform-neutral semantic steps such as `run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture`. Terminal run steps may declare `expectedExitCodes`; omission means `[0]`. Flows may also declare project-relative source dependencies that materially determine their captured result.

M7 deliberately reuses this contract. Raw Playwright selectors, browser launch flags, origins, and implementation scripts do not belong in Flow v1.

### Evidence v1 / Manifest v1

Evidence records lifecycle, artifact metadata, producer, provenance, optional SHA-256 source/Flow/artifact fingerprints, and derivation. Manifest v1 indexes Flows and Evidence and preserves source/derived relationships. Current source Evidence includes terminal tracks and web PNG screenshots.

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
- atomic evidence/manifest writes with provenance
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

- deterministic source-position section inspection with preamble support, nested paths, duplicate-safe IDs, ATX heading handling, and fenced-code awareness
- SHA-256 target base hashes plus LF/CRLF/trailing-newline facts
- DocumentPlan v1 runtime validation + published JSON Schema
- `preserve`, body-only `edit`, whole-section `replace`, anchored `create`, and reasoned `remove`
- exact source splicing rather than Markdown reserialization
- overlap/preserve/selector/create-anchor/path/symlink safety checks
- complete candidate + unified diff + deterministic `review-v1` token
- stale target/changed plan/candidate rejection
- same-directory temporary file + atomic rename apply
- safe plan discard
- `demoweave docs inspect|preview|apply|discard`
- shared Claude/Codex skill using inspect → plan → preview → approval → apply
- Ubuntu + Windows M5 dogfood proving reviewed apply and stale re-apply rejection

## M6 — Incremental stale/update tracking ✅

DemoWeave can explain why existing Evidence is fresh/stale/missing/unknown, trace that state through rendered derivations into Markdown references, and compute a minimal deterministic regeneration plan before changing anything.

Delivered:

- optional explicit `sources` on Flow v1
- SHA-256 Flow/source/artifact fingerprints
- backward-compatible preservation of Evidence-level source provenance
- git-commit fallback for older Evidence
- `unknown` instead of guessed freshness when an old baseline cannot be reached
- explicit stale/missing/unknown reason codes and recursive upstream propagation
- local Markdown impact detection
- `FreshnessReport v1`
- `demoweave status` and dry-run/selective `demoweave update`
- self-dogfood proving one Flow + two renders repair the stale chain, followed by zero-action/zero-churn update
- hosted Ubuntu + Windows coverage

## M7 — Web driver (Playwright) ✅

**Goal achieved:** DemoWeave can execute the existing semantic Flow v1 against a browser surface and capture screenshot Evidence without adding Playwright-specific operations to the shared contracts.

Delivered:

- `WebDriver` implementing `SurfaceDriver v1` for `web` surfaces
- Playwright Chromium runtime pinned in the workspace lockfile
- deterministic fresh browser context per Flow: fixed viewport/device scale, locale, UTC timezone, light color scheme, reduced motion, blocked service workers
- semantic target mapping for `text`, `label`, `role`, `name`, `testId`, `accessibilityId`, and `automationId`
- `navigate`, `activate`, `input`, `press`, and deterministic pixel `scroll`
- supported duration/visible/hidden/text waits
- visible/hidden/text-contains assertions
- explicit failures for unsupported terminal-only waits/assertions
- relative navigation through runtime `--base-url`; no guessed origin or arbitrary app-server startup
- optional `--headed` local debugging mode
- HTTP error navigation diagnostics
- viewport or element PNG screenshot capture with animation/caret suppression
- atomic screenshot writes under `.demoweave/evidence/artifacts/`
- `driver/web` Evidence provenance plus the existing M6 Flow/source/artifact fingerprint snapshot
- `demoweave doctor` Playwright Chromium readiness reporting
- local HTTP integration tests for success, missing base URL, and HTTP failure behavior
- built-CLI M7 smoke that launches Chromium, executes a semantic Flow, verifies PNG bytes/provenance/fingerprints/freshness, and validates the project
- hosted Ubuntu + Windows build/test/typecheck and M7 browser smoke coverage

M7 intentionally does **not** add raw Playwright selectors/scripts to Flow v1, auto-start arbitrary repository dev servers, or implement browser video/interaction GIF recording. Those are separate later concerns.

---

# Current pilot

## P1 — Controlled web fixture 🚧

**Goal:** turn the M7 runtime into the first public browser-evidence documentation proof, analogous to P0 for terminal evidence.

P1 should:

- use the controlled web fixture rather than an arbitrary external website
- run the real built DemoWeave CLI against a detected `web` surface
- capture a meaningful browser screenshot as fingerprinted Evidence
- use that Evidence in concise example documentation
- prove freshness/document-impact behavior on the web Evidence path
- keep the existing Flow v1 / Evidence v1 / Manifest v1 contracts unchanged
- keep application startup explicit and separate from the Flow
- remain reproducible on hosted Ubuntu and Windows

P1 does **not** need to fabricate an interaction GIF or video before a browser recording/composition milestone exists. Static browser Evidence is enough to prove the second surface honestly; animated/tutorial output remains later work.

---

# Later milestones

## M8 — Timeline compositor

Compose independent source tracks into polished single-source/split-screen scenes with crop/scale, zoom, titles, transitions, and audio — without OBS. Browser recording input should be added deliberately before claiming browser GIF/video output.

## M9 — Full tutorial output

Generate YouTube-ready MP4, thumbnail, captions, chapters, title, and description. Narration/TTS remains an optional adapter.

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
| 10 | **🚧 P1 — web fixture** | second-surface public proof |
| 11 | M8 — compositor | split-screen scenes / future browser media composition |
| 12 | M9/M10 — tutorial + QA | YouTube-ready output |
| 13 | M11 — research/notebook | research repos |
| 14 | M12 — desktop | native apps |
| 15 | M13 — mobile | Android/iOS |
| 16 | M14/M15 — ecosystem | plugins/publishers |
| 17 | 1.0 hardening | public stable release |

---

# Current next step

## NOW: P1 — web fixture pilot

Use the shipped M7 Playwright driver on the controlled web fixture, capture the first browser Evidence intended for documentation, wire that Evidence into a concise example doc, and prove the same provenance/freshness/review workflow that P0 established for terminal output.
