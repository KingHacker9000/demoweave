# DemoWeave Roadmap

DemoWeave is an agent-native documentation studio for software repositories. Claude Code or Codex supplies the reasoning; DemoWeave supplies deterministic project inspection, workflow execution, evidence capture, rendering, validation, and provenance.

DemoWeave is **multi-surface by design**. A repository may expose web, CLI, desktop, mobile, libraries/SDKs, notebooks, research pipelines, services, and generated artifacts at the same time.

## Current checkpoint

| Milestone | Status | Result |
|---|---|---|
| M0 — Repository bootstrap | ✅ Complete | TypeScript/pnpm monorepo, CLI, package boundaries, CI |
| M1 — Project analyzer | ✅ Complete | Frozen `ProjectProfile v1`; Node, Python, Rust, Go baseline |
| M2 — Flow / Evidence / Manifest | ✅ Complete | Frozen platform-neutral contracts + `SurfaceDriver v1` |
| **M3 — Terminal driver** | **🚧 Current** | Execute and capture terminal Flows deterministically |
| M4 — Media renderer | Next | Render terminal evidence to PNG/GIF/WebM/MP4 |
| **P0 — DemoWeave documents itself** | Target | First public-quality dogfood demo |

M0/M1 landed in PR #1. M2 landed in PR #2. `ProjectProfile v1`, `Flow v1`, `Evidence v1`, `Manifest v1`, and `SurfaceDriver v1` are now compatibility baselines for runtime-driver work.

## Product principles

- **Agent supplies intelligence; DemoWeave supplies deterministic tooling.**
- **Multi-surface by design.** Never collapse a repository into one `projectType`.
- **Evidence over decoration.** Visuals must explain or prove something useful.
- **Existing docs are preserved and patched intentionally**, not blindly regenerated.
- **README.md and arbitrary Markdown are first-class targets.** `/docs` is not special.
- **No OBS requirement.** Capture the smallest useful surface directly and compose later.
- **One source of truth for demos.** Structured Flows should feed screenshots, GIFs, docs, and videos.
- **Incremental by default.** Provenance should make stale evidence selectively regenerable.
- **Claude Code and Codex share the same workflow contracts.**
- Keep the core lightweight; platform-specific drivers stay optional.

## Core architecture

```text
Repository
   ↓
Project Analyzer
   ↓
ProjectProfile v1
   ↓
Documentation / Evidence Planner  ← Claude Code or Codex
   ↓
Flow v1
   ↓
SurfaceDriver v1
   ↓
Structured execution + Evidence v1
   ↓
Manifest v1 / provenance
   ↓
Renderer / document composer
   ↓
README · docs · PNG · GIF · MP4
```

## Frozen contracts

### ProjectProfile v1

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable user-surface IDs.

Baseline ecosystems:

- Node — `package.json`, pnpm/package.json workspaces
- Python — `pyproject.toml`
- Rust — `Cargo.toml`, Cargo workspaces
- Go — `go.mod`

### Flow v1

A platform-neutral workflow references one stable surface and contains semantic steps:

```text
run
navigate
activate
input
press
scroll
wait
assert
capture
```

Drivers translate those semantic actions into platform-specific behavior. Flows must not contain Playwright/Appium/VHS-specific implementation code.

### Evidence v1

Evidence can represent screenshots, recordings, structured terminal tracks, images, diagrams, plots, tables, results, code/text, and comparisons. It has lifecycle state, optional artifact metadata, producer metadata, provenance, and derivation links.

### Manifest v1

Repository-level index connecting Flow files and Evidence to stable IDs and `ProjectProfile v1` surfaces. Cross-reference validation checks Flow → surface, capture → Evidence, Evidence → Flow/step/surface, and derivation links.

---

# Milestones

## M0 — Repository bootstrap ✅

Delivered:

- TypeScript + pnpm workspace
- `@demoweave/core`, `@demoweave/cli`, `@demoweave/drivers`, `@demoweave/renderer`
- CLI binary `demoweave`
- build/test/typecheck + GitHub Actions
- MIT license
- shared `skills/demoweave/SKILL.md`

## M1 — Project analyzer ✅

Delivered commands:

```bash
demoweave doctor
demoweave init
demoweave inspect [path]
demoweave status
demoweave validate
```

Key boundary: nested non-workspace manifests are retained as deterministic component facts but do not automatically become user-facing surfaces.

## M2 — Flow IR + Evidence + Manifest ✅

Delivered:

- `Flow v1`
- `Evidence v1`
- `Manifest v1`
- `SurfaceDriver v1`
- published JSON Schemas
- terminal + web Flow examples using the same contract
- deterministic manifest normalization
- cross-file metadata validation
- `.demoweave/flows/`
- `.demoweave/evidence/manifest.json`

No runtime capture or renderer was added in M2.

---

## M3 — Terminal driver 🚧

**Goal:** execute a terminal Flow against a real CLI and produce a deterministic, replayable structured terminal track.

### Required capabilities

- Resolve a `terminal` surface from `ProjectProfile v1`.
- Implement `SurfaceDriver v1` for terminal-compatible Flow steps.
- Execute commands without going through the user's personal terminal UI.
- Capture timestamped terminal events suitable for replay/rendering.
- Preserve stdout/stderr semantics where possible.
- Record exit code and command completion.
- Support terminal dimensions.
- Preserve ANSI styling when useful.
- Sanitize obvious machine-specific presentation details where possible.
- Support terminal assertions from Flow v1.
- Convert a `capture` step of kind `terminal` into `Evidence v1` plus manifest provenance.
- Fail with structured errors rather than silently continuing.

### Terminal track v1

M3 may introduce an internal/public structured artifact for terminal playback. It should be deterministic and renderer-independent, for example conceptually:

```json
{
  "schemaVersion": 1,
  "columns": 100,
  "rows": 30,
  "events": [
    { "t": 0, "stream": "input", "data": "demoweave inspect ." },
    { "t": 32, "stream": "stdout", "data": "DemoWeave inspected ..." }
  ],
  "exitCode": 0
}
```

The exact format should be decided from real PTY/process experiments, not guessed in advance.

### Cross-platform strategy

M3 should establish a clean abstraction before overcommitting to one PTY library:

```text
TerminalDriver
    ↓
TerminalSession adapter
    ├── process/pipe mode
    └── PTY mode when interaction requires it
```

A non-interactive command should not require a PTY just to be recordable. PTY should be used where terminal semantics/interactivity genuinely require it.

### M3 dogfood Flow

Primary target:

```text
DemoWeave → demoweave inspect .
```

Expected Flow:

```text
run demoweave inspect .
assert output contains "Detected surfaces"
capture terminal evidence
```

### M3 exit criteria

- Terminal driver executes the DemoWeave self-inspection Flow.
- CLI fixture also executes through the same driver.
- Run/output/exit assertions work.
- A deterministic terminal-track artifact is written to disk.
- Evidence + manifest are updated with Flow/step/surface/source/Git provenance.
- Failure cases return structured errors and non-zero CLI exit status.
- Repeated runs produce structurally equivalent tracks apart from explicitly nondeterministic timing fields.
- Tests run on Linux CI.
- Real local validation is performed on the development Windows/WSL environment before merge.
- **No GIF rendering in M3.** Rendering belongs to M4.

---

## M4 — Lightweight media renderer

**Goal:** turn structured evidence into polished visual assets without OBS.

Default substantial media dependency: **FFmpeg**.

Initial outputs:

- PNG
- GIF
- WebM
- MP4

First target: render M3 terminal tracks into a clean controlled terminal presentation, independent of the user's actual shell theme/window chrome.

### M4 exit criteria

- Terminal track → clean PNG.
- Terminal track → optimized Markdown GIF.
- Reasonable duration/dimension/file-size limits.
- Deterministic render settings.
- `demoweave doctor` reports renderer/FFmpeg capability clearly.

---

# Pilot P0 — DemoWeave documents DemoWeave

**Goal:** Claude Code or Codex uses DemoWeave to improve DemoWeave's own README using real runtime evidence.

```text
agent understands repo
  → demoweave inspect .
  → chooses useful CLI workflow
  → writes Flow
  → DemoWeave executes Flow
  → terminal Evidence
  → renderer creates GIF
  → agent patches README
  → DemoWeave validates references/provenance
```

### Acceptance criteria

1. Fresh clone installs normally.
2. `demoweave doctor` succeeds.
3. DemoWeave profiles itself correctly.
4. Claude Code can follow the shared DemoWeave skill.
5. Codex can follow the same workflow.
6. Agent creates a valid useful Flow.
7. DemoWeave executes the Flow.
8. A clean terminal track is captured.
9. Renderer creates a Markdown-appropriate GIF.
10. README embeds it intentionally.
11. Useful existing manual sections survive.
12. `demoweave validate` verifies metadata/assets/references.
13. No-change rerun avoids unnecessary churn.
14. Relevant source changes can eventually mark evidence stale.

---

## M5 — Document planning + safe Markdown patching

Arbitrary Markdown targets with section-aware `preserve`, `edit`, `replace`, `create`, and justified `remove` operations. Add diff/review/refine/discard UX before saving changes.

## M6 — Incremental stale/update tracking

Use Manifest provenance to explain why evidence/docs are stale and selectively regenerate only affected artifacts.

## M7 — Web driver (Playwright)

Implement Flow v1 against browser surfaces: launch/wait, navigate, semantic interaction, assertions, screenshots, viewport recordings, and element bounds.

### Pilot P1 — Web fixture

Generate a hero screenshot, interaction GIF, short MP4, and example documentation from the controlled web fixture without changing the Flow/Evidence contracts.

## M8 — Timeline compositor

Compose independent source recordings/tracks into polished single-source, split-screen, crop/scale, zoom, title, transition, and audio scenes without OBS.

## M9 — Full tutorial output

Generate YouTube-ready:

```text
tutorial.mp4
thumbnail.png
captions.srt
captions.vtt
chapters.txt
youtube-title.txt
youtube-description.md
```

Narration/TTS remains an optional adapter.

## M10 — Visual QA

Agent-review sampled frames for readability, secret exposure, clipping, broken/loading states, dead time, and narration/visual mismatch. Structured beats should allow partial re-recording.

## M11 — Research / notebook driver

Use real notebook/script outputs, plots, benchmark tables, generated images/videos, comparison grids, and experiment artifacts rather than screenshots of notebook UI when possible.

## M12 — Desktop drivers

Planned adapters: Electron, Windows, macOS, Linux. Capture priority:

1. semantic/application-native capture
2. window-specific OS capture
3. region capture
4. display capture

No OBS requirement.

## M13 — Mobile drivers

Android/iOS adapters implementing the same semantic actions: activate/tap, input, swipe/scroll, wait, assert, capture.

## M14 — Plugin/driver SDK

Third-party extension points for surface drivers, evidence producers, renderers, publishers, and detectors.

## M15 — Documentation publishers

Integrate rather than replace existing stacks. Potential adapters: plain Markdown/GitHub, Fumadocs, Mintlify, Docusaurus, VitePress, MkDocs.

---

# 1.0 target

DemoWeave 1.0 should provide stable contracts, Claude/Codex workflows, multi-surface project analysis, terminal + web + process/library support, screenshot/GIF/video evidence, arbitrary Markdown support, safe patch/review, incremental stale tracking, lightweight FFmpeg composition, polished tutorials, and an extension path for desktop/mobile/research.

# Development order

| Order | Milestone | Demo value |
|---|---|---|
| 1 | ✅ M0 — scaffold | real project skeleton |
| 2 | ✅ M1 — analyzer | understands repositories |
| 3 | ✅ M2 — Flow/Evidence/Manifest | stable internal contracts |
| 4 | **🚧 M3 — terminal driver** | DemoWeave runs itself |
| 5 | M4 — GIF renderer | first visual artifact |
| 6 | **P0 — self-document README** | **first killer demo** |
| 7 | M5 — safe Markdown patching | reliable docs |
| 8 | M6 — stale tracking | living documentation |
| 9 | M7 — web driver | website support |
| 10 | **P1 — web fixture** | second-surface proof |
| 11 | M8 — compositor | split-screen scenes |
| 12 | M9/M10 — tutorial + QA | YouTube-ready output |
| 13 | M11 — research/notebook | research repos |
| 14 | M12 — desktop | native apps |
| 15 | M13 — mobile | Android/iOS |
| 16 | M14/M15 — ecosystem | plugins/publishers |
| 17 | 1.0 hardening | public stable release |

---

# Current next step

## NOW: M3 — Terminal Driver

Implement and locally validate the first real `SurfaceDriver v1` against DemoWeave itself.

**Do now:** terminal-session abstraction, command execution, structured terminal track, Flow assertions, terminal Evidence creation, manifest updates, tests, and self-dogfood execution.

**Do not do yet:** terminal PNG/GIF rendering, FFmpeg composition, Playwright, Markdown rewriting, or stale-detection logic.

The immediate goal is simple: **DemoWeave must be able to execute its own `demoweave inspect .` Flow and leave behind a clean, replayable terminal Evidence artifact with correct provenance.**
