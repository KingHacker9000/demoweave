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
| **M7 — Web driver (Playwright)** | **🚧 Current** | Implement Flow v1 against browser surfaces |

M0/M1 landed in PR #1, M2 in PR #2, M3 in PR #3, M4 in PR #4, Pilot P0 in PR #5, M5 in PR #6, and M6 in PR #7.

## Product principles

- **Agent supplies intelligence; DemoWeave supplies deterministic tooling.**
- **Multi-surface by design.** Never collapse a repository into one `projectType`.
- **Evidence over decoration.** Visuals must explain or prove something useful.
- **Preserve good existing documentation.** Patch intentionally instead of regenerating blindly.
- **README.md and arbitrary Markdown are first-class targets.** `/docs` is not special.
- **No OBS requirement.** Capture the smallest useful surface directly and compose later.
- **One source of truth for demos.** Structured Flows feed evidence, GIFs, docs, and later tutorials.
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
  ↓
Evidence v1 + Manifest v1 + fingerprints
  ↓
Renderer
  ↓
PNG / GIF
  ↓
FreshnessReport v1
  ↓
minimal selective update
  ↓
DocumentPlan v1
  ↓
reviewed Markdown patch
```

P0 proved the evidence path with DemoWeave itself. M5 added the reviewed document-editing path. M6 closes the loop for living documentation: current Flow/source/artifact bytes are compared with deterministic provenance fingerprints, stale state propagates through derived Evidence, impacted Markdown is identified, and only the necessary Flow/render actions are proposed.

## Established contracts

### ProjectProfile v1

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable surface IDs. Baseline ecosystems: Node (`package.json`), Python (`pyproject.toml`), Rust (`Cargo.toml`), and Go (`go.mod`).

### Flow v1

Platform-neutral semantic steps such as `run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture`. Terminal run steps may declare `expectedExitCodes`; omission means `[0]`. Flows may also declare project-relative source dependencies that materially determine their captured result.

### Evidence v1 / Manifest v1

Evidence records lifecycle, artifact metadata, producer, provenance, optional SHA-256 source/Flow/artifact fingerprints, and derivation. Manifest v1 indexes Flows and Evidence and preserves source/derived relationships.

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

**Goal achieved:** DemoWeave can explain why existing Evidence is fresh/stale/missing/unknown, trace that state through rendered derivations into Markdown references, and compute a minimal deterministic regeneration plan before changing anything.

Delivered:

- optional explicit `sources` on Flow v1 with roles for implementation/config/fixture/data/asset/other
- SHA-256 fingerprints for producing Flow definitions, declared source dependencies, source Evidence artifacts, and CLI-rendered derived artifacts
- backward-compatible preservation of pre-existing Evidence-level source provenance
- git-commit fallback for older Evidence that predates fingerprints
- `unknown` state when an old baseline cannot be reached, rather than guessed freshness
- explicit reason codes for changed/missing artifacts, source dependencies, Flow definitions, declared lifecycle state, and upstream propagation
- recursive stale/missing/unknown propagation through `derivedFrom`
- local Markdown link/image resolution to identify documents impacted by affected Evidence
- `FreshnessReport v1` runtime validation + published JSON Schema
- `demoweave status [path] [--json]` freshness explanations
- `demoweave update [path] [--json]` dry-run minimal regeneration plan
- `demoweave update [path] --apply` selective execution
- one producing Flow run per affected Flow, followed only by required PNG/GIF renders
- unknown Evidence excluded from automatic regeneration
- full-history CI so legacy git baselines can be validated
- self-dogfood that begins from stale committed evidence, explains the source → Evidence → PNG/GIF → README chain, applies exactly one Flow + two renders, reaches fully fresh state, then runs update again with **zero actions and zero tracked byte churn**
- hosted Ubuntu + Windows build/test/typecheck and M6 dogfood coverage

M6 deliberately does not infer undocumented source dependencies, rewrite impacted prose automatically, or implement browser capture.

---

# Current milestone

## M7 — Web driver (Playwright) 🚧

**Goal:** implement Flow v1 against browser surfaces without changing the platform-neutral Flow/Evidence contracts.

Initial scope:

- launch/connect to a web surface deterministically
- `navigate`
- semantic target resolution for existing interaction target strategies
- `activate`, `input`, `press`, and `scroll`
- supported waits/assertions
- screenshots and bounded viewport recordings as Evidence
- browser/viewport metadata and useful failure diagnostics
- deterministic cleanup and path safety
- provenance/freshness integration using the M6 contracts rather than a separate web-specific stale system

Do not embed raw Playwright selectors or scripts into Flow v1. Browser implementation details belong in the web driver.

### P1 — Web fixture

After the driver is stable, generate a hero screenshot, interaction GIF, short video, and example documentation from a controlled web fixture without changing the Flow/Evidence contracts.

---

# Later milestones

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
| 6 | ✅ P0 — self-document README | first public-quality dogfood demo |
| 7 | ✅ M5 — safe Markdown patching | reliable reviewed document edits |
| 8 | ✅ M6 — stale tracking | living documentation |
| 9 | **🚧 M7 — web driver** | website support |
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

## NOW: M7 — Playwright web driver

Implement the first browser-backed `SurfaceDriver v1` while keeping Flow v1 semantic and platform-neutral. Start with a controlled fixture and deterministic screenshot evidence; then add interaction/assertion coverage and short viewport recording before Pilot P1.
