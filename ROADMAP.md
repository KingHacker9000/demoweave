# DemoWeave Roadmap

DemoWeave is an agent-native documentation studio for software repositories.

The goal is simple: give Claude Code or Codex a repository, let the agent understand and run the project, collect real evidence from the surfaces users interact with, and generate clean written + visual documentation that stays in sync with the codebase.

DemoWeave is **not** web-only. A single repository may expose several surfaces at once: web, CLI, desktop, mobile, libraries/SDKs, notebooks, research pipelines, and generated artifacts.

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

DemoWeave should stabilize these before broad platform support:

1. **ProjectProfile** — deterministic facts about a repository and all detected surfaces.
2. **DocPlan** — what documents/sections should exist and what should be preserved, added, or changed.
3. **Flow** — platform-neutral description of a user/research workflow.
4. **Evidence** — screenshot, GIF, video, terminal capture, result, plot, table, diagram, etc.
5. **Timeline** — presentation/composition of evidence tracks for longer tutorials.
6. **Manifest** — provenance linking docs/assets to flows, source files, and commits.

---

# Milestones

## M0 — Repository bootstrap

**Goal:** establish the TypeScript monorepo and stable package boundaries.

Planned structure:

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
  cli/
  web/
  library/
```

Initial requirements:

- TypeScript
- pnpm workspace
- build/test/lint/typecheck scripts
- CLI binary named `demoweave`
- CI on GitHub Actions
- MIT license

**Exit criteria**

- Fresh clone installs successfully.
- `pnpm build`, `pnpm test`, and `pnpm typecheck` pass.
- `demoweave --help` runs locally.

---

## M1 — Project analyzer

**Goal:** deterministic repository inspection with no LLM API dependency.

Initial commands:

```bash
demoweave doctor
demoweave init
demoweave inspect [path]
demoweave status
demoweave validate
```

`inspect` should detect facts such as:

- package managers and workspace layout
- languages
- frameworks
- package binaries / CLI entry points
- build/test/run scripts
- web surfaces
- libraries/SDKs
- notebooks/research directories
- existing README/docs files
- examples/tests/configuration files

Output:

```text
.demoweave/project.json
.demoweave/config.json
```

Important: repositories may expose **multiple surfaces simultaneously**.

**Exit criteria**

- DemoWeave correctly profiles itself.
- CLI fixture is detected as terminal/CLI.
- web fixture is detected as web.
- library fixture is detected as a code/library surface.
- `ProjectProfile` v1 schema is validated and frozen for the next milestone.

---

## M2 — Flow IR + Evidence model + manifest

**Goal:** create platform-neutral workflow and evidence contracts before capture implementations grow.

Example flow:

```yaml
id: inspect-project
surface: cli
steps:
  - run:
      command: demoweave inspect .
  - assert:
      stdout_contains: "Detected surfaces"
  - capture:
      id: inspection-result
```

Create:

```text
.demoweave/flows/
.demoweave/evidence/manifest.json
```

**Exit criteria**

- JSON Schema validation for Flow, Evidence, and Manifest.
- Driver API accepts semantic actions rather than Playwright/Appium-specific code.
- Provenance can associate evidence with a flow, source files, and a Git commit.

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

Default media dependency: **FFmpeg**.

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
3. `demoweave inspect .` recognizes DemoWeave as a TypeScript CLI/tooling repository.
4. Claude Code can follow `skills/demoweave/SKILL.md`.
5. Codex can follow the same underlying skill/workflow.
6. Agent identifies `demoweave inspect .` (or another genuinely useful CLI workflow) as evidence worth showing.
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

Plans should explicitly mark sections as:

- preserve
- edit
- replace
- create
- remove (rare and justified)

Add a review workflow inspired by good diff/refine tools:

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

The manifest should explain *why* something is stale.

**Exit criteria**

- Source changes can mark related evidence stale.
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

Support initially:

- single source
- split screen
- crop/scale
- simple focus/zoom
- text/title overlays
- simple transitions
- audio track

Example use:

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

Narration/TTS must be an adapter, never a hard core dependency.

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

Evidence types expand to include:

- PlotEvidence
- TableEvidence
- ResultEvidence
- ComparisonEvidence
- AnimationEvidence

---

## M12 — Desktop drivers

**Goal:** native/electron desktop apps without OBS.

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

**Goal:** allow third-party drivers, evidence producers, renderers, and publishers.

Potential extension points:

- SurfaceDriver
- EvidenceProducer
- Renderer
- Publisher
- Detector

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
| 1 | M0 — scaffold | real project skeleton |
| 2 | M1 — analyzer | understands repositories |
| 3 | M2 — Flow/Evidence/Manifest | stable internal contracts |
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

## NOW: M0 + M1

Build the initial TypeScript workspace and implement:

```bash
demoweave --help
demoweave doctor
demoweave init
demoweave inspect .
```

Also add the CLI, web, and library fixtures plus CI.

**Do not start media capture yet.**

The immediate goal is to make `demoweave inspect .` produce a clean, validated `ProjectProfile` for DemoWeave itself and all three fixture categories. Once that representation is solid, freeze `ProjectProfile` v1 and move to M2.
