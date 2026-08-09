# DemoWeave Roadmap

DemoWeave is an agent-native documentation studio for software repositories. Claude Code or Codex supplies the reasoning; DemoWeave supplies deterministic project inspection, workflow execution, evidence capture, rendering, validation, and provenance.

DemoWeave is **multi-surface by design**. A repository may expose web, CLI, desktop, mobile, libraries/SDKs, notebooks, research pipelines, services, and generated artifacts at the same time.

## Current checkpoint

| Milestone | Status | Result |
|---|---|---|
| M0 — Repository bootstrap | ✅ Complete | TypeScript/pnpm monorepo, CLI, package boundaries, CI |
| M1 — Project analyzer | ✅ Complete | `ProjectProfile v1`; Node, Python, Rust, Go baseline |
| M2 — Flow / Evidence / Manifest | ✅ Complete | Platform-neutral workflow/evidence contracts + `SurfaceDriver v1` |
| M3 — Terminal driver | ✅ Complete | Cross-platform Flow execution + `TerminalTrack v1` |
| M4 — Media renderer | ✅ Complete | TerminalTrack → polished PNG/GIF + derived Evidence |
| **P0 — DemoWeave documents itself** | **🚧 Current** | First public-quality dogfood README |
| M5 — Safe Markdown patching | Next | Section-aware planning, diff/review/refine/discard |

M0/M1 landed in PR #1, M2 in PR #2, M3 in PR #3, and M4 in PR #4.

The first complete evidence path now works end to end:

```text
Repository
  ↓
demoweave inspect
  ↓
ProjectProfile v1
  ↓
Flow v1
  ↓
TerminalDriver
  ↓
TerminalTrack v1
  ↓
Evidence v1 + Manifest v1
  ↓
DemoWeave renderer
  ↓
PNG / GIF
```

The repository dogfoods this path with `inspect-project-terminal`, plus derived `inspect-project-terminal-png` and `inspect-project-terminal-gif` assets under `docs-media/`.

## Product principles

- **Agent supplies intelligence; DemoWeave supplies deterministic tooling.**
- **Multi-surface by design.** Never collapse a repository into one `projectType`.
- **Evidence over decoration.** Visuals must explain or prove something useful.
- **Preserve good existing documentation.** Patch intentionally instead of regenerating blindly.
- **README.md and arbitrary Markdown are first-class targets.** `/docs` is not special.
- **No OBS requirement.** Capture the smallest useful surface directly and compose later.
- **One source of truth for demos.** Structured Flows feed evidence, GIFs, docs, and later tutorials.
- **Incremental by default.** Provenance should make stale evidence selectively regenerable.
- **Claude Code and Codex share the same workflow contracts.**
- Keep the core lightweight; platform-specific drivers/renderers stay isolated.

## Established contracts

### ProjectProfile v1

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable surface IDs.

Baseline ecosystems: Node (`package.json`), Python (`pyproject.toml`), Rust (`Cargo.toml`), and Go (`go.mod`).

### Flow v1

A platform-neutral workflow references a stable surface and uses semantic steps such as `run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture`. Terminal run steps may explicitly declare `expectedExitCodes`; omission means `[0]`.

### Evidence v1 / Manifest v1

Evidence records lifecycle, artifact metadata, producer, provenance, and derivation. Manifest v1 indexes Flows and Evidence and preserves relationships such as:

```text
inspect-project-terminal
    ├── inspect-project-terminal-png
    └── inspect-project-terminal-gif
```

### TerminalTrack v1

Renderer-independent terminal capture with dimensions, portable command/cwd metadata, ordered input/stdout/stderr events, ANSI-preserving output, process lifecycle, exit code/signal, and duration.

Normal non-zero exits are factual `completed` process lifecycles; Flow success is evaluated independently.

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

Commands:

```bash
demoweave doctor
demoweave init
demoweave inspect [path]
demoweave status
demoweave validate
```

Nested non-workspace manifests remain deterministic component facts without automatically leaking into user-facing surfaces.

## M2 — Flow IR + Evidence + Manifest ✅

- Flow v1
- Evidence v1
- Manifest v1
- SurfaceDriver v1
- synchronized JSON Schemas
- deterministic manifest normalization
- cross-file metadata validation
- terminal + web example Flows

## M3 — Terminal driver ✅

- `TerminalDriver → TerminalSession → ProcessTerminalSession`
- pipe-based non-interactive capture; no PTY requirement
- Windows + Linux/WSL execution
- `demoweave run <flow-id-or-path>`
- output/exit/file assertions and waits
- timeouts + structured failures
- TerminalTrack v1 + schema
- atomic Evidence/Manifest writes with provenance
- committed self-dogfood `inspect-project` Flow
- Windows + Ubuntu hosted CI

## M4 — Lightweight media renderer ✅

- TerminalTrack replay isolated from presentation/encoding
- safe ANSI/control handling for current pipe-mode tracks
- deterministic command typing + progressive output + final hold
- SVG terminal presentation
- `@resvg/resvg-js` headless PNG rasterization
- optional FFmpeg two-pass palette GIF encoding
- `demoweave render <evidence-id-or-path> --format png|gif`
- configured `mediaDir` output safety
- FFmpeg capability in `demoweave doctor`
- derived renderer Evidence + provenance
- real committed pilot assets:
  - `docs-media/inspect-project-terminal.png`
  - `docs-media/inspect-project-terminal.gif`
- 1020×486 GIF, 5 seconds, 60 frames at 12 fps, ~36 KiB
- Windows + Ubuntu hosted render smoke tests
- visual review completed before merge

Intentional M4 boundary: no PTY emulator, web/desktop/mobile capture, compositor, narration, or MP4 tutorial pipeline yet.

---

# Current pilot

## P0 — DemoWeave documents DemoWeave 🚧

**Goal:** use the same shared DemoWeave workflow we expect users to use and produce the first public-quality README from real repository understanding + real runtime evidence.

```text
Codex / Claude Code
       ↓
understand DemoWeave repository
       ↓
demoweave inspect .
       ↓
review existing README + Manifest
       ↓
choose useful existing evidence
       ↓
embed docs-media/inspect-project-terminal.gif intentionally
       ↓
rewrite/preserve sections based on actual repository facts
       ↓
run commands/examples
       ↓
demoweave validate .
       ↓
review README diff + rendered GitHub presentation
```

### P0 rules

- Do **not** rewrite the README merely to make it longer.
- Preserve correct/useful existing content.
- The GIF must support the explanation rather than act as decoration.
- Do not claim future features as currently available.
- Clearly distinguish current capabilities from roadmap capabilities.
- All commands shown as current usage must actually work.
- Keep the README visual and scannable rather than AI-wall-of-text documentation.
- Use relative repository asset paths suitable for GitHub Markdown.
- P0 may improve the committed self-demo Flow/evidence only if a real documentation problem is discovered; avoid unrelated M5+ implementation.

### P0 acceptance criteria

1. Fresh clone installs normally.
2. `demoweave doctor` succeeds.
3. `demoweave inspect .` profiles DemoWeave correctly.
4. Codex can follow `skills/demoweave/SKILL.md` without bespoke hidden instructions about the repository.
5. The same shared skill remains usable by Claude Code.
6. Agent identifies the existing self-inspection Flow/Evidence as useful documentation evidence.
7. `demoweave run inspect-project` succeeds.
8. Source terminal Evidence remains valid.
9. `demoweave render inspect-project-terminal --format gif` succeeds.
10. README intentionally embeds the generated GIF.
11. Useful existing manual sections survive where appropriate.
12. README accurately describes **current** commands/capabilities.
13. Installation/development commands shown in README execute.
14. `demoweave validate .` passes after documentation changes.
15. README links/assets resolve on GitHub.
16. Final README diff is manually reviewed for information density, hierarchy, and visual polish.
17. A second reasoning pass identifies no unsupported product claims.

P0 does **not** implement the general Markdown planner/patcher. That is M5. P0 proves the agent-native workflow manually using the same deterministic DemoWeave primitives.

---

# Next milestones

## M5 — Document planning + safe Markdown patching

Arbitrary Markdown targets with section-aware `preserve`, `edit`, `replace`, `create`, and justified `remove` operations. Add diff/review/refine/discard UX before saving changes.

## M6 — Incremental stale/update tracking

Use Manifest provenance to explain why evidence/docs are stale and selectively regenerate only affected artifacts.

## M7 — Web driver (Playwright)

Implement Flow v1 against browser surfaces: launch/wait, navigate, semantic interaction, assertions, screenshots, viewport recordings, and element bounds.

### P1 — Web fixture

Generate a hero screenshot, interaction GIF, short video, and example documentation from the controlled web fixture without changing the Flow/Evidence contracts.

## M8 — Timeline compositor

Compose independent source tracks into polished single-source/split-screen scenes with crop/scale, zoom, titles, transitions, and audio — without OBS.

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

DemoWeave 1.0 should provide stable agent workflows and contracts, multi-surface analysis, terminal + web + process/library support, screenshot/GIF/video evidence, arbitrary Markdown support, safe patch/review, incremental stale tracking, lightweight media composition, tutorial output, and an extension path for desktop/mobile/research.

# Development order

| Order | Milestone | Demo value |
|---|---|---|
| 1 | ✅ M0 — scaffold | real project skeleton |
| 2 | ✅ M1 — analyzer | understands repositories |
| 3 | ✅ M2 — Flow/Evidence/Manifest | stable internal contracts |
| 4 | ✅ M3 — terminal driver | DemoWeave runs itself |
| 5 | ✅ M4 — GIF renderer | first visual artifact |
| 6 | **🚧 P0 — self-document README** | **first public-quality dogfood demo** |
| 7 | M5 — safe Markdown patching | reliable docs |
| 8 | M6 — stale tracking | living documentation |
| 9 | M7 — web driver | website support |
| 10 | P1 — web fixture | second-surface proof |
| 11 | M8 — compositor | split-screen scenes |
| 12 | M9/M10 — tutorial + QA | YouTube-ready output |
| 13 | M11 — research/notebook | research repos |
| 14 | M12 — desktop | native apps |
| 15 | M13 — mobile | Android/iOS |
| 16 | M14/M15 — ecosystem | plugins/publishers |
| 17 | 1.0 hardening | public stable release |

---

# Current next step

## NOW: P0 — DemoWeave documents itself

Use DemoWeave exactly as an external project would: inspect the repository, review the existing docs and evidence, run/verify the self-demo, then create a concise polished README that embeds the real generated GIF and accurately explains what DemoWeave can do **today**.

Do not implement M5 inside P0. The point of this pilot is to prove that Claude Code/Codex + the shared skill + DemoWeave's deterministic primitives already form a useful end-to-end documentation workflow.
