# DemoWeave Roadmap

DemoWeave is an agent-native documentation studio for software repositories. Claude Code or Codex supplies the reasoning; DemoWeave supplies deterministic project inspection, workflow execution, evidence capture, rendering, document patching, validation, and provenance.

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
| **M5 — Safe Markdown patching** | **🚧 Current** | Section-aware plan → preview/review token → atomic apply |
| M6 — Incremental stale tracking | Next | Explain and selectively regenerate stale evidence/docs |

M0/M1 landed in PR #1, M2 in PR #2, M3 in PR #3, M4 in PR #4, and Pilot P0 in PR #5.

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

## Established pipeline

```text
Repository
  ↓
ProjectProfile v1
  ↓
Agent reasoning
  ↓
Flow v1
  ↓
SurfaceDriver v1
  ↓
Evidence v1 + Manifest v1
  ↓
Renderer
  ↓
PNG / GIF
  ↓
README / docs
```

P0 proved this with DemoWeave itself: Codex followed the checked-in shared skill, inspected the repository, ran the committed terminal Flow, refreshed structured evidence, rendered the GIF, and rewrote the README without claiming unimplemented features.

## Established contracts

### ProjectProfile v1

Deterministic repository facts: components, ecosystems, manifests, workspaces, entrypoints, languages, frameworks, commands, existing docs, and stable surface IDs. Baseline ecosystems: Node (`package.json`), Python (`pyproject.toml`), Rust (`Cargo.toml`), and Go (`go.mod`).

### Flow v1

Platform-neutral semantic steps such as `run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture`. Terminal run steps may declare `expectedExitCodes`; omission means `[0]`.

### Evidence v1 / Manifest v1

Evidence records lifecycle, artifact metadata, producer, provenance, and derivation. Manifest v1 indexes Flows and Evidence and preserves source/derived relationships.

### TerminalTrack v1

Renderer-independent terminal capture with dimensions, portable command/cwd metadata, ordered input/stdout/stderr events, ANSI-preserving output, process lifecycle, exit code/signal, and duration.

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

Pilot result:

- Codex followed `skills/demoweave/SKILL.md` without a DemoWeave-specific hidden workflow.
- The repo was inspected and validated using the real built CLI.
- The committed self Flow executed successfully and refreshed TerminalTrack provenance.
- PNG/GIF were regenerated from evidence; same-input rendering was byte-stable.
- The README embeds the real generated GIF near the top with accurate context.
- Current vs planned features are clearly separated.
- No public npm/plugin installation was invented.
- README commands/links/assets were audited.
- Hosted Ubuntu + Windows CI passed on the P0 head.

This proves the agent-native workflow before automating document patching itself.

---

# Current milestone

## M5 — Document planning + safe Markdown patching 🚧

**Goal:** give agents a deterministic way to inspect arbitrary Markdown, declare intentional section-level changes, preview the exact diff, obtain a review fingerprint, and apply only the reviewed patch without rewriting untouched content.

The reasoning stays in Claude Code/Codex. DemoWeave should not decide what prose to write.

```text
Markdown file
   ↓
section map + base hash
   ↓
agent-authored DocumentPlan v1
   ↓
validate selectors / operations
   ↓
preview patch in memory
   ↓
unified diff + review token
   ↓
review / refine / discard
   ↓
atomic apply only if base + review token still match
```

### M5 architecture boundaries

- **Preserve original source bytes outside edited ranges.** Do not parse and reserialize the entire Markdown file.
- Use a real Markdown parser/position model rather than brittle regex-only heading matching.
- Markdown parsing may locate section ranges; patching should splice the original source.
- Support arbitrary project-relative Markdown targets, not only `README.md` or `/docs`.
- Never allow target paths to escape the repository.
- Reject stale plans if the target changed since the plan's base hash was computed.
- Preview must not mutate the target.
- Apply must be atomic.
- A reviewed patch must not silently change between preview and apply.
- Keep agent prose/content out of DemoWeave's deterministic core; the plan carries agent-authored Markdown.
- Do not implement M6 stale/provenance tracking inside M5.

### Document section model

M5 should expose stable, human/agent-readable section information derived from Markdown headings and source positions. It must handle duplicate heading text without ambiguous selection.

A useful selector may include a heading path plus occurrence/stable section ID. Exact schema should be chosen during implementation, but selection must remain deterministic after inspection.

The tool also needs a way to target the document preamble/body region where appropriate.

### DocumentPlan v1

The agent should be able to express intentional operations such as:

- `preserve` — explicitly record that an existing section should remain untouched.
- `edit` — replace a section body while preserving its heading identity.
- `replace` — replace an entire selected section when heading/content structure changes.
- `create` — insert a new section before/after a deterministic anchor.
- `remove` — remove an existing section; must include a non-empty reason.

Plans should include at minimum:

- schema version
- plan ID
- project-relative target path
- target base SHA-256/content hash
- ordered operations with stable operation IDs

Do not add speculative fields unrelated to safe patching.

### Review token

`preview` should compute the complete candidate output and emit a deterministic review token/fingerprint derived from the base target + normalized plan + resulting candidate content.

`apply` should require the matching review token (or an equivalently strong reviewed-state mechanism) and refuse when:

- the target hash changed
- the plan changed
- the candidate diff changed

This makes the apply step explicitly tied to what was reviewed.

### CLI shape

Prefer one coherent command group, conceptually:

```bash
demoweave docs inspect README.md
demoweave docs preview .demoweave/plans/readme.json
demoweave docs apply .demoweave/plans/readme.json --review <token>
demoweave docs discard .demoweave/plans/readme.json
```

Exact naming may change if a cleaner implementation emerges, but avoid many overlapping commands.

`inspect` should provide enough section IDs/paths and the target hash for an agent to author a plan. `preview` should show a concise operation summary and unified diff. `apply` should report exactly what changed. `discard` must never touch the target document.

### Safety / preservation requirements

M5 must correctly handle or safely reject cases involving:

- ATX headings (`#` through `######`)
- fenced code blocks containing heading-like text
- duplicate headings
- nested headings
- CRLF vs LF
- no trailing newline
- empty sections
- files with no headings
- Unicode headings/content
- invalid/missing selectors
- overlapping operations
- conflicting create anchors
- stale base hashes
- target/plan path traversal
- symlink escape where relevant to Node filesystem behavior

Untouched sections and whitespace should remain byte-for-byte unchanged wherever possible.

### M5 exit criteria

M5 is complete when:

1. A Markdown target can be inspected into a deterministic section map + SHA-256 base hash.
2. DocumentPlan v1 has runtime validation and a published JSON Schema.
3. `preserve`, `edit`, `replace`, `create`, and reasoned `remove` are implemented with documented semantics.
4. Duplicate headings can be selected unambiguously.
5. Code-fence heading-like text is not misidentified as a document section.
6. Preview produces the full candidate output and a readable unified diff without mutating the target.
7. Preview emits a deterministic review token.
8. Apply refuses without the matching reviewed token.
9. Apply refuses if target or plan changed after preview.
10. Apply writes atomically and preserves untouched source ranges.
11. Discard removes/invalidates the plan without touching the target.
12. Project-root path safety is enforced.
13. README and non-README Markdown fixtures are both covered.
14. Windows and Linux/WSL newline/path behavior are tested.
15. The shared DemoWeave skill uses the real inspect → plan → preview → approval → apply workflow.
16. Hosted Ubuntu + Windows CI is green.
17. DemoWeave dogfoods M5 on a small real Markdown refinement without creating README churn.

M5 does not implement automatic document authorship, stale detection, web capture, or tutorial composition.

---

# Later milestones

## M6 — Incremental stale/update tracking

Use Manifest/document provenance to explain why evidence/docs are stale and selectively regenerate only affected artifacts.

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
| 6 | ✅ P0 — self-document README | first public-quality dogfood demo |
| 7 | **🚧 M5 — safe Markdown patching** | reliable reviewed document edits |
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

## NOW: M5 — section-aware Markdown patching

Build the first deterministic document-editing contract and CLI around arbitrary Markdown. The agent must be able to inspect section IDs and a base hash, author a plan, preview the exact patch, show it for review, refine without touching the file, and apply only the reviewed candidate atomically.

The dogfood target for M5 should be deliberately small: use the new mechanism to make one justified README or documentation refinement while proving that unrelated sections remain byte-identical.
