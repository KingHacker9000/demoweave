# DemoWeave Roadmap

DemoWeave is an agent-native documentation studio for software repositories.

The goal is simple: give Claude Code or Codex a repository, let the agent understand and run the project, collect real evidence from the surfaces users interact with, and generate clean written + visual documentation that stays in sync with the codebase.

DemoWeave is **not** web-only. A single repository may expose several surfaces at once: web, CLI, desktop, mobile, libraries/SDKs, notebooks, research pipelines, and generated artifacts.

## Current checkpoint

| Milestone | Status | Result |
|---|---|---|
| M0 — Repository bootstrap | ✅ Complete | TypeScript/pnpm monorepo, CLI, package boundaries, CI |
| M1 — Project analyzer | ✅ Complete | Frozen `ProjectProfile v1`; Node, Python, Rust, Go baseline; 15 analyzer tests |
| **M2 — Flow IR + Evidence + Manifest** | **🚧 Current** | Freeze platform-neutral workflow/evidence/provenance contracts |
| M3 — Terminal driver | Next | First runtime evidence driver |
| M4 — Media renderer | Later | PNG/GIF/WebM/MP4 via lightweight rendering |
| P0 — DemoWeave documents itself | Target | First public-quality dogfood demo |

M0/M1 landed through PR #1. `ProjectProfile v1` is now the compatibility baseline for subsequent milestones.

## Product principles

- **Agent supplies intelligence; DemoWeave supplies deterministic tooling.**
- **Multi-surface by design.** Never reduce a repository to one `projectType`.
- **Evidence over decoration.** Screenshots, GIFs, plots, terminal captures, and videos must prove or explain something useful.
- **Existing docs are preserved and patched intentionally**, not blindly regenerated.
- **README.md is first-class**, but arbitrary Markdown targets are equally supported.
- **No OBS requirement.** Capture the smallest useful surface directly and compose with FFmpeg.
- **One source of truth for tutorials.** A structured flow should be reusable for screenshots, GIFs, docs, and full videos.
- **Incremental by default.** Track provenance so stale documentation can be regenerated selectively.
- **Claude Code and Codex share the same core skill/workflow.**
- Keep the core lightweight; platform-specific drivers stay optional.

---

## Core architecture

```text
Repository
   |
   v
Project Analyzer
   |
   v
Project Profile
   |
   v
Documentation / Evidence Planner  <-- Claude Code or Codex
   |
   v
Universal Flow IR
   |
   +-------------------------------+
   |               |               |
   v               v               v
Surface Drivers  Process/Result   Existing Artifacts
   |               |               |
   +---------------+---------------+
                   |
                   v
              Evidence Store
                   |
                   v
              Media Renderer
                   |
                   v
       Markdown / GIF / PNG / MP4
                   |
                   v
          Manifest + stale tracking
```

### Core models

1. **ProjectProfile** — deterministic facts about a repository and all detected surfaces. **v1 frozen at M1.**
2. **DocPlan** — what documents/sections should exist and what should be preserved, added, or changed.
3. **Flow** — platform-neutral description of a user/research workflow.
4. **Evidence** — screenshot, GIF, video, terminal capture, result, plot, table, diagram, etc.
5. **Timeline** — presentation/composition of evidence tracks for longer tutorials.
6. **Manifest** — provenance linking docs/assets to flows, source files, and commits.

---

# Milestones

## M0 — Repository bootstrap ✅

**Goal:** establish the TypeScript monorepo and stable package boundaries.

Delivered:

```text
packages/
  cli/
  core/
  drivers/
  renderer/
skills/
  demoweave/
    SKILL.md
schemas/
fixtures/
```

- TypeScript + pnpm workspace
- CLI binary named `demoweave`
- build/test/typecheck scripts
- CI on GitHub Actions
- MIT license

**Exit criteria:** complete.

---

## M1 — Project analyzer ✅

**Goal:** deterministic repository inspection with no LLM API dependency.

Delivered commands:

```bash
demoweave doctor
demoweave init
demoweave inspect [path]
demoweave status
demoweave validate
```

`ProjectProfile v1` records deterministic facts including:

- package managers/tooling evidence
- workspace layout
- ecosystem-neutral components
- manifests and entrypoints
- languages/frameworks
- build/test/run commands when evidenced
- detected user surfaces
- existing documentation

Baseline ecosystems:

- Node — `package.json`, pnpm/package.json workspaces
- Python — `pyproject.toml`
- Rust — `Cargo.toml`, Cargo workspaces
- Go — `go.mod`

A repository may expose **multiple surfaces simultaneously**.

**Exit criteria:** complete. `ProjectProfile v1` is frozen as the compatibility baseline.

Known M1 boundaries intentionally left for later:

- Detection is manifest/structure based; it does not execute surfaces.
- Python dynamic metadata and complex Poetry script objects are not fully modeled.
- Python workspaces and Go `go.work` are not yet modeled.
- Nested non-workspace manifests are retained as facts but do not automatically emit user-facing surfaces.

---

## M2 — Flow IR + Evidence model + Manifest 🚧

**Goal:** create platform-neutral workflow, evidence, and provenance contracts before capture implementations grow.

The Flow IR must describe **semantic intent**, not Playwright/Appium/VHS implementation calls.

Example:

```yaml
schemaVersion: 1
id: inspect-project
surface: terminal-demoweave-cli
steps:
  - run:
      command: demoweave inspect .
  - assert:
      stdout_contains: "Detected surfaces"
  - capture:
      id: inspection-result
```

M2 should create stable models for:

```text
Flow
FlowStep
Evidence
EvidenceRef
Manifest
Provenance
SourceDependency
Driver contract
```

Expected repository state:

```text
.demoweave/
  flows/
  evidence/
    manifest.json
schemas/
  flow.schema.json
  evidence.schema.json
  manifest.schema.json
```

Requirements:

- Every Flow references a real `ProjectProfile` surface by stable surface ID.
- Actions are semantic and platform-neutral where possible.
- Capture requests describe desired evidence, not renderer-specific encoding details.
- Evidence has stable identity, type, path/status, producer metadata, and provenance.
- Provenance can link evidence to a Flow, source paths, and Git commit.
- Manifest is deterministic and machine-editable.
- Missing/stale files can eventually be represented without redesigning the model.
- Driver API consumes semantic actions and returns structured execution/capture results.
- Runtime Zod schemas and published JSON Schemas remain synchronized.

**Exit criteria**

- JSON Schema + runtime validation for Flow, Evidence, and Manifest.
- Driver API accepts semantic actions rather than Playwright/Appium-specific code.
- Provenance can associate evidence with a Flow, source files, and a Git commit.
- Example terminal and web Flows validate against the same Flow contract.
- Manifest round-trip tests are deterministic.
- No capture/PTY/Playwright implementation is required to finish M2.

---

## M3 — Terminal driver

**Goal:** first real evidence driver and first dogfooding surface.

Capture:

- command input
- stdout/stderr
- timestamps
- exit status
- terminal dimensions
- ANSI styling where useful

Prefer a controlled rendered terminal over recording the user's personal terminal window.

**Exit criteria**

- DemoWeave can execute a CLI Flow against itself.
- Output is replayable deterministically.
- Captured output is suitable for rendering without leaking local usernames/terminal chrome.

---

## M4 — Lightweight media renderer

**Goal:** render first visual evidence assets without OBS.

Default substantial media dependency: **FFmpeg**.

Initial output formats:

- PNG
- GIF
- WebM
- MP4

For Markdown GIFs, optimize for short duration, readable text, sane dimensions, and palette-based encoding.

**Exit criteria**

- Terminal capture can become a clean PNG and GIF.
- GIF generation is deterministic and bounded by basic size/duration rules.
- `demoweave doctor` clearly reports media capability/FFmpeg availability.

---

# Pilot P0 — DemoWeave documents DemoWeave

This is the first major proof of the architecture.

**Goal:** Claude Code or Codex uses DemoWeave to improve DemoWeave's own README with real evidence.

Expected workflow:

```text
agent understands repo
      -> demoweave inspect .
      -> chooses a useful CLI workflow
      -> writes Flow
      -> DemoWeave executes Flow
      -> DemoWeave renders GIF
      -> agent patches README.md
      -> DemoWeave validates assets/links
```

### P0 acceptance criteria

1. Fresh clone installs with the normal workspace command.
2. `demoweave doctor` succeeds.
3. `demoweave inspect .` recognizes DemoWeave correctly.
4. Claude Code can follow `skills/demoweave/SKILL.md`.
5. Codex can follow the same underlying skill/workflow.
6. Agent identifies a genuinely useful CLI workflow as evidence worth showing.
7. Agent creates a valid Flow.
8. DemoWeave executes the Flow.
9. DemoWeave records a clean terminal track.
10. Renderer produces a Markdown-appropriate GIF.
11. Agent updates `README.md` and embeds the generated asset.
12. Existing manually useful sections are preserved.
13. `demoweave validate` verifies generated assets and Markdown references.
14. A second run with no source changes does not unnecessarily rewrite documentation/assets.
15. Changing a source file associated with the Flow marks the relevant evidence/documentation stale.

**P0 is the first public-quality demo target.**

---

## M5 — Document planning + safe Markdown patching

**Goal:** arbitrary Markdown targets with section-aware preservation.

Targets include:

```text
README.md
CONTRIBUTING.md
ARCHITECTURE.md
docs/*.md
any other Markdown target selected by the agent/user
```

Plans should explicitly mark sections as preserve, edit, replace, create, or justified removal.

Add a review workflow inspired by strong diff/refine tools:

```text
proposed docs/assets
      -> diff/review
      -> accept | refine | discard
```

**Exit criteria**

- Existing sections can be intentionally preserved.
- Agent can attach evidence to planned sections.
- Proposed text/media changes can be reviewed before save.

---

## M6 — Incremental stale/update tracking

**Goal:** living documentation rather than one-shot generation.

Commands:

```bash
demoweave status
demoweave validate
```

Future convenience command:

```bash
demoweave update
```

**Exit criteria**

- Source changes can mark related evidence stale.
- Manifest explains why an artifact is stale.
- Unrelated docs/assets remain current.
- Regeneration can be selective.

---

## M7 — Web driver (Playwright)

**Goal:** browser evidence without making the product web-specific.

Capabilities:

- launch/wait for app
- navigate
- click/input/hover/scroll
- semantic assertions
- screenshots
- viewport recordings
- element bounds for focus/zoom/callouts

**Exit criteria**

- Web fixture flow runs end to end.
- Screenshot and short GIF are generated.
- Same Flow/Evidence contracts used by the terminal driver remain valid.

---

# Pilot P1 — Web fixture

Use `fixtures/web` as a controlled integration specimen.

Generate:

- hero screenshot
- interaction GIF
- short 30–60 second MP4
- `docs/examples/web.md`

**Success condition:** CLI and web pilots work without changing the core Flow/Evidence abstractions.

---

## M8 — Timeline compositor

**Goal:** compose independent surface recordings into polished scenes without OBS.

Initial support:

- single source
- split screen
- crop/scale
- simple focus/zoom
- text/title overlays
- simple transitions
- audio track

Example:

```text
terminal recording + browser recording
                 ->
          polished split-screen tutorial
```

---

## M9 — Full tutorial output

**Goal:** generate YouTube-ready tutorials from structured beats/timeline.

Outputs:

```text
tutorial.mp4
thumbnail.png
captions.srt
captions.vtt
chapters.txt
youtube-title.txt
youtube-description.md
```

Narration/TTS is an adapter, never a hard core dependency.

Possible modes:

- none
- local TTS
- provider adapter
- user-supplied audio

---

## M10 — Visual QA

**Goal:** automatically review generated assets before publishing.

Checks should include:

- readable text
- no obvious secret exposure
- no clipped content
- no broken/loading states
- important action visible
- no excessive dead time
- narration/visual alignment where applicable

Structured tutorial beats should allow re-recording only the failed beat.

---

## M11 — Research / notebook driver

**Goal:** support scientific and ML/CV repositories as first-class projects.

Detect/use:

- notebooks
- training/inference/evaluation scripts
- benchmark outputs
- plots/tables
- generated images/videos
- comparison grids

Prefer actual generated artifacts over screenshots of notebook UI.

Evidence types expand to include plots, tables, structured results, comparisons, and animations.

---

## M12 — Desktop drivers

**Goal:** native/Electron desktop apps without OBS.

Planned adapters:

```text
electron
windows
macos
linux
```

Capture priority:

1. semantic/application-native capture
2. window-specific OS capture
3. region capture
4. display capture

---

## M13 — Mobile drivers

**Goal:** Android/iOS support through adapters while preserving the same semantic Flow actions.

Typical actions:

- click/tap
- input
- swipe
- wait
- assert
- screenshot
- record

---

## M14 — Plugin/driver SDK

**Goal:** allow third-party drivers, evidence producers, renderers, publishers, and detectors.

---

## M15 — Documentation publishers

DemoWeave should not become another docs-site framework.

Publisher adapters may support:

- plain Markdown / GitHub
- Fumadocs
- Mintlify
- Docusaurus
- VitePress
- MkDocs

If a project already uses a documentation stack, integrate rather than replace it.

---

# 1.0 target

DemoWeave 1.0 should provide:

- stable schemas and plugin interfaces
- Claude Code + Codex workflows
- project analysis
- multi-surface detection
- terminal + web + process/library support
- screenshot/GIF/video evidence
- README + arbitrary Markdown support
- safe patch/review workflow
- incremental stale tracking
- lightweight FFmpeg composition
- polished tutorial generation
- a tested path for optional desktop/mobile/research drivers

---

# Development order

| Order | Milestone | Demo value |
|---|---|---|
| 1 | ✅ M0 — scaffold | real project skeleton |
| 2 | ✅ M1 — analyzer | understands repositories |
| 3 | **🚧 M2 — Flow/Evidence/Manifest** | stable internal contracts |
| 4 | M3 — terminal driver | DemoWeave runs itself |
| 5 | M4 — GIF renderer | first visual artifact |
| 6 | **P0 — self-document README** | **first killer demo** |
| 7 | M5 — safe Markdown patching | reliable docs |
| 8 | M6 — stale tracking | living documentation |
| 9 | M7 — web driver | website support |
| 10 | **P1 — web fixture** | second surface proof |
| 11 | M8 — compositor | split-screen scenes |
| 12 | M9/M10 — tutorial + QA | YouTube-ready output |
| 13 | M11 — research/notebook | research repos |
| 14 | M12 — desktop | native apps |
| 15 | M13 — mobile | Android/iOS |
| 16 | M14/M15 — ecosystem | plugins/publishers |
| 17 | 1.0 hardening | public stable release |

---

# Current next step

## NOW: M2 — Flow IR + Evidence + Manifest

Build and freeze the contracts that every runtime driver will consume.

Immediate work:

1. Define `Flow v1` and semantic step/action schemas.
2. Define `Evidence v1` with stable IDs, evidence kinds, lifecycle status, output paths, and provenance.
3. Define `Manifest v1` as the repository-level index of flows/evidence.
4. Define the first platform-neutral `SurfaceDriver` contract in `@demoweave/drivers`.
5. Publish synchronized JSON Schemas under `schemas/`.
6. Add valid/invalid fixtures plus round-trip/determinism tests.
7. Extend `demoweave validate` to validate M2 metadata when present.
8. Add example terminal and web Flows proving the IR is not tied to either platform.

**Do not implement PTY capture, Playwright, FFmpeg, or media rendering in M2.**

The immediate goal is to make the M3 terminal driver implement a stable contract rather than forcing us to redesign Flow/Evidence once additional surfaces arrive.
