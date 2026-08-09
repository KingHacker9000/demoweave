# DemoWeave Roadmap

DemoWeave is an agent-native documentation studio for software repositories. Claude Code or Codex supplies the reasoning; DemoWeave supplies deterministic project inspection, workflow execution, evidence capture, rendering, validation, and provenance.

DemoWeave is **multi-surface by design**. A repository may expose web, CLI, desktop, mobile, libraries/SDKs, notebooks, research pipelines, services, and generated artifacts at the same time.

## Current checkpoint

| Milestone | Status | Result |
|---|---|---|
| M0 — Repository bootstrap | ✅ Complete | TypeScript/pnpm monorepo, CLI, package boundaries, CI |
| M1 — Project analyzer | ✅ Complete | Frozen `ProjectProfile v1`; Node, Python, Rust, Go baseline |
| M2 — Flow / Evidence / Manifest | ✅ Complete | Platform-neutral contracts + `SurfaceDriver v1` |
| M3 — Terminal driver | ✅ Complete | Cross-platform terminal Flow execution + `TerminalTrack v1` |
| **M4 — Media renderer** | **🚧 Current** | TerminalTrack → polished PNG/GIF, lightweight FFmpeg pipeline |
| **P0 — DemoWeave documents itself** | Target | First public-quality dogfood README demo |

M0/M1 landed in PR #1, M2 in PR #2, and M3 in PR #3. The first full runtime evidence path now works end to end: a Flow can execute DemoWeave itself and leave behind structured terminal Evidence with manifest provenance.

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
- Keep the core lightweight; platform-specific drivers and renderers stay optional where practical.

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
Structured execution
   ↓
Evidence v1 + Manifest v1
   ↓
Renderer
   ↓
PNG · GIF · WebM · MP4
   ↓
README · docs · tutorials
```

## Frozen / established contracts

### ProjectProfile v1

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable surface IDs.

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

Terminal `run` steps may optionally declare `expectedExitCodes`; omission means `[0]`. Drivers translate semantic actions into platform behavior. Flows must not contain Playwright/Appium/VHS/renderer-specific implementation code.

### Evidence v1

Evidence represents screenshots, recordings, structured terminal tracks, images, diagrams, plots, tables, results, code/text, and comparisons. It has lifecycle state, artifact metadata, producer metadata, provenance, and derivation links.

### Manifest v1

Repository-level index connecting Flow files and Evidence to stable IDs and `ProjectProfile v1` surfaces. Derived media should be linked back to its source Evidence rather than becoming an unrelated asset.

### TerminalTrack v1

Renderer-independent terminal playback artifact containing:

- terminal dimensions
- pipe capture mode
- command/args + portable cwd
- ordered timestamped input/stdout/stderr events
- ANSI-preserving output
- factual process lifecycle (`completed`, `timedOut`, `spawnFailed`, `signaled`)
- exit code, signal, and duration

A normal non-zero process exit is still `completed`; Flow success is evaluated separately against the run step's expected exit codes.

---

# Completed milestones

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

Baseline ecosystem-neutral component detection works for Node, Python, Rust, and Go. Nested non-workspace manifests are retained as deterministic facts without automatically leaking into user-facing surfaces.

## M2 — Flow IR + Evidence + Manifest ✅

Delivered:

- `Flow v1`
- `Evidence v1`
- `Manifest v1`
- `SurfaceDriver v1`
- synchronized published JSON Schemas
- terminal + web example Flows using the same contract
- deterministic manifest normalization
- cross-file metadata validation
- `.demoweave/flows/`
- `.demoweave/evidence/manifest.json`

## M3 — Terminal driver ✅

Delivered:

- `TerminalDriver → TerminalSession → ProcessTerminalSession`
- lightweight pipe-based capture; no PTY requirement for non-interactive commands
- cross-platform command execution on Windows and Linux/WSL
- `demoweave run <flow-id-or-path>`
- stdout/stderr/combined assertions, file assertions, waits, timeouts, and structured failure behavior
- optional Flow `expectedExitCodes`
- `TerminalTrack v1` runtime + published schema
- ANSI-preserving timestamped terminal events
- atomic terminal artifact + Manifest updates
- Git/Flow/step/surface/source provenance
- self-dogfood Flow `.demoweave/flows/inspect-project.json`
- committed DemoWeave self-inspection terminal Evidence
- Windows + Ubuntu hosted CI running the real self-dogfood Flow

Intentional M3 boundary: pipe mode only; no interactive PTY, no visual renderer.

---

# Current milestone

## M4 — Lightweight media renderer 🚧

**Goal:** turn structured terminal Evidence into polished documentation media without recording the user's desktop and without requiring OBS.

The first vertical slice is deliberately narrow:

```text
inspect-project TerminalTrack
        ↓
terminal replay/model
        ↓
controlled visual frame
        ↓
clean PNG
        ↓
frame sequence
        ↓
FFmpeg
        ↓
optimized README GIF
        ↓
derived Evidence + Manifest provenance
```

### M4 architectural boundaries

- Rendering consumes `TerminalTrack v1`; it does not rerun the Flow.
- Keep terminal parsing/replay separate from visual styling and encoding.
- Preserve the source track untouched.
- Do not depend on the user's shell theme, terminal app, wallpaper, or desktop recorder.
- Do not require OBS, Electron, or a bundled browser just to render terminal media.
- FFmpeg is the default substantial media dependency for animated/video encoding.
- If a lightweight rasterizer/ANSI parser is required for deterministic frame generation, keep it isolated behind the renderer package.
- Cross-platform render semantics matter more than byte-identical pixels across operating systems.
- Do not build the future split-screen/tutorial compositor in M4.

### First terminal visual style

The default renderer should produce a clean controlled presentation:

```text
╭────────────────────────────────────────────────────╮
│  ●  ●  ●                         DemoWeave         │
├────────────────────────────────────────────────────┤
│  $ node packages/cli/dist/index.js inspect .       │
│                                                    │
│  DemoWeave inspected demoweave-workspace           │
│  Languages: TypeScript ...                         │
│  Detected surfaces:                                │
│    - library    @demoweave/core                     │
│    - library    @demoweave/drivers                  │
│    - library    @demoweave/renderer                 │
│    - terminal   demoweave                           │
│                                                    │
│  Wrote .demoweave/project.json                     │
╰────────────────────────────────────────────────────╯
```

The frame should be intentionally designed for README readability: controlled padding, high contrast, monospace text, sensible chrome, bounded dimensions, and no dependence on the user's terminal configuration.

### M4 CLI target

Prefer one coherent command rather than format-specific commands, conceptually:

```bash
demoweave render <evidence-id-or-path> --format png
demoweave render <evidence-id-or-path> --format gif
```

The exact options should stay small. Defaults should be good enough that an agent does not need to tune twenty rendering parameters.

### Derived Evidence

Rendering should create new Evidence entries rather than mutate the source terminal Evidence.

Conceptually:

```text
inspect-project-terminal       kind: terminal
    ↓ derivedFrom
inspect-project-terminal-png   kind: image, format: png
inspect-project-terminal-gif   kind: recording, format: gif
```

Rendered files should go through `.demoweave/config.json`'s `mediaDir` (currently `docs-media`) and be safe to reference from Markdown.

### GIF defaults

Initial README-oriented targets:

- roughly 8–15 fps
- bounded width around documentation-friendly desktop sizes
- short duration derived from the track; avoid gratuitous holds
- optimized palette
- loop cleanly where sensible
- aggressive but readable size control
- warn/fail when an asset is obviously unsuitable for Markdown rather than silently producing a huge GIF

### M4 exit criteria

M4 is complete when all of the following are true:

1. The committed DemoWeave self-inspection TerminalTrack can be loaded by the renderer.
2. TerminalTrack → clean PNG works locally.
3. TerminalTrack → animated GIF works locally using FFmpeg.
4. The GIF visibly replays the recorded command/output rather than merely displaying the final frame.
5. ANSI SGR styling used by pipe-mode tracks is handled safely; unsupported escape behavior does not corrupt output.
6. The renderer does not expose absolute project/home paths that the source track already sanitized.
7. Render settings are explicit and deterministic.
8. Output dimensions/duration/file size are reported.
9. Rendered assets are written under configured `mediaDir`.
10. PNG/GIF are indexed as derived Evidence with renderer provenance and `derivedFrom` linking to the source terminal Evidence.
11. `demoweave validate` accepts the resulting manifest/assets metadata.
12. `demoweave doctor` clearly reports FFmpeg availability/capability.
13. Renderer unit/integration tests pass without requiring a desktop environment.
14. Hosted CI remains green; FFmpeg-dependent tests may run where FFmpeg is explicitly installed/available.
15. The real generated self-inspection PNG and GIF are visually reviewed before merge.

**Do not patch README in M4.** Embedding the new GIF into the README is Pilot P0 immediately after M4.

---

# Pilot P0 — DemoWeave documents DemoWeave

**Goal:** Claude Code or Codex uses DemoWeave to improve DemoWeave's own README using real runtime evidence.

```text
agent understands repo
  → demoweave inspect .
  → chooses useful CLI workflow
  → Flow already captures terminal Evidence
  → renderer creates GIF
  → agent patches README intentionally
  → DemoWeave validates references/provenance
```

### Acceptance criteria

1. Fresh clone installs normally.
2. `demoweave doctor` succeeds.
3. DemoWeave profiles itself correctly.
4. Claude Code can follow the shared DemoWeave skill.
5. Codex can follow the same workflow.
6. Agent can identify/use a valid useful Flow.
7. DemoWeave executes the Flow.
8. A clean terminal track is captured.
9. Renderer creates a Markdown-appropriate GIF.
10. README embeds it intentionally.
11. Useful existing manual sections survive.
12. `demoweave validate` verifies metadata/assets/references.
13. A no-change rerun avoids unnecessary churn where supported.
14. Relevant source changes can eventually mark evidence stale (M6).

---

# Later milestones

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
| 4 | ✅ M3 — terminal driver | DemoWeave runs itself |
| 5 | **🚧 M4 — GIF renderer** | first visual artifact |
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

## NOW: M4 — TerminalTrack → first polished GIF

Implement and visually validate the smallest complete renderer path against DemoWeave's **already committed self-inspection terminal Evidence**.

Immediate work:

1. Inspect `TerminalTrack v1`, `Evidence v1`, Manifest v1, `.demoweave/config.json`, and the current empty renderer package.
2. Define a small renderer API: source track → deterministic visual frames → encoded asset.
3. Implement pipe-track replay sufficient for current ANSI/line-oriented terminal evidence without tying the renderer to a specific terminal app.
4. Produce a controlled terminal frame as vector/structured layout, then a PNG.
5. Add FFmpeg detection/invocation and encode an optimized animated GIF from replay frames.
6. Add one `demoweave render` command supporting `png` and `gif` first.
7. Write outputs under configured `docs-media` and update Manifest with derived Evidence + renderer provenance.
8. Add tests for replay, ANSI handling, dimensions, output paths, manifest derivation, missing FFmpeg, and invalid source evidence.
9. Render the real `inspect-project-terminal` Evidence on the development machine.
10. **Open and visually inspect the PNG and GIF** before declaring M4 complete.

Do not add Playwright, PTY interaction, split-screen composition, narration, YouTube generation, or README patching yet.

The milestone ends when we have a genuinely good-looking DemoWeave-generated GIF ready to embed in the README. That asset becomes the input to Pilot P0.
