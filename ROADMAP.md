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
| **M10 — Visual QA** | **🚧 Current** | Deterministic sample packet → agent-reviewed hash-bound PASS/NEEDS-CHANGES report |
| M11 — Research / notebook driver | Next | Native plots/results/experiments as first-class Evidence |

Milestone PR history: M0/M1 #1, M2 #2, M3 #3, M4 #4, P0 #5, M5 #6, M6 #7, M7 #8, M5 hardening #9, P1 #10, M8 #11, M9 #12. M10 is draft PR #13.

## Product principles

- **Agent supplies intelligence; DemoWeave supplies deterministic tooling.**
- **Evidence over decoration.** Visuals must explain or prove something useful.
- **Multi-surface by design.** Never collapse a repository into one `projectType`.
- **Capture, presentation, and review are separate stages.**
- **No OBS requirement.** Capture the smallest useful surface directly and compose later.
- **No hidden LLM calls.** The agent authors prose, tutorial narrative, and visual-QA findings.
- **Preserve good existing documentation.** Patch intentionally instead of regenerating blindly.
- **README.md and arbitrary Markdown are first-class targets.** `/docs` is not special.
- **Freshness before regeneration or review.** Unknown/stale evidence is never silently treated as current.
- **One source of truth for demos.** Structured Flows feed Evidence; presentation plans derive media without rewriting what happened.
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

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable surface IDs. Baseline ecosystems: Node, Python, Rust, Go.

### Flow v1

Platform-neutral semantic actions (`run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, `capture`) plus optional explicit source dependencies. Runtime browser configuration and presentation metadata do not belong in Flow.

### Evidence v1 / Manifest v1

Typed artifact lifecycle, producer, provenance, source/Flow/artifact fingerprints, derivation relationships, and project indexing.

### TerminalTrack v1

Renderer-independent terminal capture: dimensions, command metadata, ordered input/stdout/stderr, ANSI-preserving output, process lifecycle, exit result, and duration.

### DocumentPlan v1

Hash-bound Markdown operations (`preserve`, direct-body `edit`, subtree `replace`, anchored `create`, reasoned `remove`) with exact preview, unified diff, review token, and atomic apply.

### FreshnessReport v1

Evidence classification (`fresh`, `stale`, `missing`, `unknown`), explicit reason chains, impacted Markdown, and the currently supported minimal regeneration actions.

### TimelinePlan v1

Presentation-only single/split scenes with explicit canvas/FPS/background, padding/gap/ratio, `contain`/`cover`, root Evidence/file sources, and MP4/GIF output.

### TutorialPlan v1

Agent-authored title/description/language/tags, caption timing/text, chapter timing/titles, and thumbnail treatment bound to existing MP4 Evidence.

### VisualQAPacket / VisualQAReport v1

Current M10 review contract. DemoWeave generates deterministic sample frames/contact sheet/timing/context/signals from **fresh** PNG/GIF/MP4 Evidence. The agent visually reviews those samples and authors a durable PASS/NEEDS-CHANGES report bound to the exact packet and source hashes.

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

---

# Current milestone

## M10 — Visual QA 🚧

**Goal:** make visual review reproducible without pretending that deterministic media analysis replaces agent judgment.

```text
fresh PNG/GIF/MP4 Evidence
        ↓
demoweave qa prepare
        ↓
VisualQAPacket v1 (generated/cache)
  ├─ exact source hash/dimensions/duration
  ├─ deterministic uniform sample frames
  ├─ contact sheet
  ├─ scene/caption context when provenance exposes it
  └─ advisory black/freeze ranges
        ↓
agent opens/inspects the actual images
        ↓
VisualQAReport v1 (durable)
  ├─ packet/source hash binding
  ├─ PASS or NEEDS-CHANGES
  └─ structured findings/recommendations
        ↓
demoweave qa finalize
        ↓
derived agent/visual-qa result Evidence
```

### M10 rules

- Review only fresh Evidence; stale/missing/unknown sources are rejected by the public prepare command.
- The packet is generated cache; the report is durable agent-authored metadata.
- Black/freeze detection is advisory. A deliberate final reading hold is not automatically a failure.
- DemoWeave does not secretly call a vision model or OCR engine.
- PASS cannot contain error findings.
- NEEDS-CHANGES must contain warning/error findings and returns a failing CLI status after the review is recorded.
- Changed source/packet/sample/contact-sheet bytes invalidate finalization; prepare and review again.
- No automatic media fix is performed after a finding.

### M10 current scope

- PNG/GIF/MP4 source Evidence
- deterministic uniform sampling
- generated contact sheet
- project/path/symlink/hash safety
- MP4 probing through ffprobe
- GIF/MP4 sample extraction through FFmpeg
- active Timeline scene / Tutorial caption context where provenance exposes plans
- black-range / freeze-range signals
- finding categories for readability, clipping, loading state, visible-secret risk, dead time, caption mismatch, composition, text overlap, flicker, other
- `demoweave qa prepare`
- `demoweave qa finalize`
- finalized result Evidence derived from the reviewed source
- freshness propagation into the durable QA result

### M10 dogfood target

Review the real fresh `terminal-web-proof-mp4` composition using seven samples.

The reviewed proof should establish:

- both panes remain legible and unclipped;
- aspect ratio/spacing is intentional;
- terminal reveal progresses correctly;
- browser pane remains honestly static;
- no browser chrome, machine path, notification, or visible secret appears;
- the final freeze signal (~2.65–5.0s) is the deliberate reading hold rather than accidental dead time.

CI prepares the exact packet from a freshly recomposed source. Linux encodes the completed review findings into the packet-bound report and runs `qa finalize`; Windows independently exercises the same contracts and smoke path.

### M10 acceptance criteria

1. VisualQAPacket v1 is generated deterministically from fresh PNG/GIF/MP4 Evidence.
2. Packet includes source hash/dimensions/duration, ordered sample timestamps/hashes, contact-sheet hash, and advisory signals.
3. Generated packet/frames live under cache; durable reports live separately.
4. VisualQAReport v1 binds exact packet and source hashes.
5. PASS/NEEDS-CHANGES severity rules are validated.
6. Finalization refuses pending/stale/changed source, changed packet, changed sample/contact sheet, or invalid finding references.
7. PASS creates derived `agent/visual-qa` result Evidence.
8. NEEDS-CHANGES records the review but returns a non-zero gate status.
9. Freshness propagation makes a finalized review stale when its reviewed source changes.
10. Scene/caption context is surfaced when plan provenance is available.
11. Black/freeze heuristics remain signals, never automatic verdicts.
12. Real M8 dogfood contact sheet/full-size samples are visually reviewed.
13. Final M8 proof receives a real packet-bound PASS review with the intentional final hold recorded explicitly.
14. Ubuntu and Windows pass build/tests/typecheck and M10 smoke; Linux also runs the real finalized dogfood gate.
15. README/shared skill describe the workflow accurately without claiming OCR, hidden vision APIs, auto-fix, or browser recording.
16. M11 is not started inside the M10 PR.

---

# Later milestones

## M11 — Research / notebook driver

Use native outputs where possible rather than screenshots of notebook UI:

- notebook/script execution
- plots/figures
- benchmark/result tables
- generated images/videos
- experiment metadata/comparisons
- deterministic output Evidence and provenance

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

DemoWeave 1.0 should provide stable agent workflows/contracts, multi-surface analysis, terminal + web + process/library support, evidence-backed screenshot/GIF/video presentation where supported, arbitrary Markdown review/apply, incremental stale tracking, lightweight composition, tutorial packaging, reproducible agent visual QA, and extension paths for research/desktop/mobile.

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
| 13 | **🚧 M10 — visual QA** | reproducible agent review gate |
| 14 | M11 — research/notebook | research repos |
| 15 | M12 — desktop | native apps |
| 16 | M13 — mobile | Android/iOS |
| 17 | M14/M15 — ecosystem | plugins/publishers |
| 18 | 1.0 hardening | public stable release |

## Current next step

Finish the real `terminal-web-proof` packet-bound PASS review, keep the full cross-platform suite green, merge M10, then move to **M11 — Research / notebook driver**.
