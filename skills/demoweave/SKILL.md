# DemoWeave Skill

Use DemoWeave when the user asks to create, improve, update, or validate documentation for a software repository.

## Principles

- Treat the repository as potentially multi-surface: web, CLI, desktop, mobile, library/SDK, notebook, research, service, or combinations of these.
- Use DemoWeave for deterministic inspection, execution, evidence capture, rendering, composition, tutorial packaging, visual-review preparation/binding, freshness analysis, Markdown patch review, validation, and provenance.
- Use your own repository tools to understand intent, architecture, and which workflows actually matter.
- Do not generate visual media merely to decorate a document. Capture evidence only when it improves comprehension.
- Prefer native result artifacts over screenshots of tool/notebook chrome when the artifact itself is what users need to understand: plots, tables, metrics, generated images/videos, and executed notebooks should stay native where possible.
- Preserve useful existing documentation. Prefer intentional section-level edits over rewriting files wholesale.
- Never assume `/docs` is the only output. README.md and arbitrary Markdown files are first-class targets.
- The agent supplies judgment and narrative. DemoWeave does not secretly call an LLM to write prose, tutorial captions, or visual-QA findings.
- Treat `unknown` freshness as unresolved information, not permission to regenerate or review. Never invent a baseline.
- Prefer DemoWeave's minimal regeneration plan over rerunning an entire evidence pipeline manually.
- Keep runtime/browser/environment configuration out of Flow v1 unless it is an explicit project command. Do not embed Playwright selectors, guessed package/environment setup, browser launch settings, recorder commands, renderer/compositor layout, or tutorial metadata in a Flow.
- Declare project-relative Flow `sources` only for material inputs such as code, config, fixtures, or data. A disposable generated output being captured is not automatically a source dependency.
- Keep capture, presentation, and review separate. A composed static browser screenshot is still a static browser screenshot; a captured `.ipynb` is still a notebook artifact, not proof that notebook UI was recorded.
- Black/freeze ranges produced by visual QA are advisory signals, not automatic verdicts.
- Never reuse a visual-QA report after its packet or source bytes changed. Prepare and visually review the new packet.
- Do not invent DemoWeave commands or Flow actions. Check `demoweave --help` and the published schemas first.

## Repository and evidence workflow

1. Run `demoweave doctor` when environment readiness matters.
2. Run `demoweave init .` if DemoWeave metadata has not been initialized.
3. Run `demoweave inspect .` to produce `.demoweave/project.json`.
4. Read ProjectProfile together with the repository itself. ProjectProfile contains facts; use repository tools to decide what matters to users.
5. Create a Flow v1 under `.demoweave/flows/` when a workflow needs runtime evidence.
6. Set `surfaceId` to an existing stable surface ID from ProjectProfile.
7. Declare only project-relative Flow `sources` that materially determine the captured result.
8. Use semantic Flow actions such as `run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture` where supported by the selected surface.
9. Execute the Flow with the appropriate runtime context.
10. Successful capture updates Manifest/Evidence and fingerprints the Flow, declared sources, and artifact.
11. Run `demoweave validate .` after metadata/evidence changes.
12. Before regenerating or visually reviewing existing Evidence, inspect freshness with `demoweave status .`.

## Terminal Flow workflow

```bash
demoweave run <flow-id-or-path>
demoweave run <flow-id-or-path> --project <path>
```

The terminal driver is currently non-interactive process/pipe execution. It supports terminal-compatible `run`, waits, assertions, and capture. A `run` expects exit code `0` unless `expectedExitCodes` explicitly accepts another result.

A successful terminal capture writes:

```text
.demoweave/evidence/artifacts/<evidence-id>.terminal.json
```

Render terminal Evidence with:

```bash
demoweave render <evidence-id-or-path> --format png
demoweave render <evidence-id-or-path> --format gif
```

PNG is headless/built in. GIF additionally requires FFmpeg.

## Web Flow workflow

The web driver implements Flow v1 against Playwright Chromium.

Check readiness:

```bash
demoweave doctor
```

If Chromium is missing in a source checkout:

```bash
pnpm --filter @demoweave/drivers exec playwright install chromium
```

Start the application separately with its real project command. DemoWeave does not guess how arbitrary repositories should start.

For relative navigation, provide the runtime origin:

```bash
demoweave run <flow-id-or-path> --base-url http://127.0.0.1:3000
```

Use `--headed` only when a visible browser helps local debugging.

Prefer semantic targets (`role`, `label`, test/automation IDs) over brittle text where available. Raw Playwright selectors do not belong in Flow v1.

Current web capture writes PNG screenshot Evidence. Browser interaction GIF/video recording is not implemented; do not fabricate or claim it.

## Windows desktop Flow workflow

The Windows UI Automation backend executes existing semantic Flow v1 actions against an already-running application. DemoWeave does not infer or launch the executable. Supply one explicit positive process ID at runtime:

```bash
demoweave run <flow-id-or-path> --desktop-pid <pid>
```

The PID is invocation context only. Do not store it in Flow v1, ProjectProfile, Evidence provenance, config, or the manifest. The attached process must expose exactly one plausible top-level UIA application window in the current interactive session; missing, windowless, cross-session, and multi-window processes fail explicitly.

Prefer `automationId` targets. Current factual mappings are:

- `automationId` / `accessibilityId` → UIA AutomationId;
- `name` / `text` / `label` → UIA accessible Name;
- `role` → a small explicit UIA ControlType map;
- `testId` → unsupported.

Current Windows actions are `activate` through InvokePattern, `input` through ValuePattern, explicit basic navigation/Enter key presses, visible/hidden/text waits, visible/hidden/text assertions, and targetless `capture` with `kind: "screenshot"` for the attached top-level window. Scrolling and element capture are not implemented. There is no coordinate-click, full-display, OBS, or ambiguous-window fallback.

For stale desktop Evidence, keep the application running and pass the same runtime context through selective regeneration:

```bash
demoweave update <project> --apply --desktop-pid <pid>
```

The committed `fixtures/desktop-windows` example uses a native WinForms executable with stable AutomationIds and proves window-only PNG Evidence plus freshness/no-churn behavior. Build and launch the fixture separately before running its Flow.

## Research / notebook workflow

The research driver implements Flow v1 for `research` and `notebook` surfaces. It runs only commands explicitly declared by the Flow and captures native project-local files rather than guessing an environment or screen-recording notebook UI.

Use ordinary `run`, `wait`, and `assert` steps for the repository's real workflow. A project may explicitly invoke `jupyter`, `uv`, `python`, `poetry`, R, Julia, MATLAB, a compiled binary, or another command already available in its environment. DemoWeave does **not** install or infer those tools.

Capture a generated native artifact with optional `capture.artifact.path`:

```json
{
  "id": "capture-plot",
  "type": "capture",
  "evidenceId": "training-curve",
  "kind": "plot",
  "artifact": { "path": "outputs/training-curve.svg" }
}
```

`target` and `artifact` are mutually exclusive. UI targets remain for semantic UI drivers; `artifact.path` is for project-local files.

Choose Evidence kind by meaning, not extension:

- `plot` for figures/curves;
- `table` for benchmark/result tables;
- `result` for metrics, summaries, or executed notebook artifacts;
- `image` for generated images;
- `recording` for generated GIF/WebM/MP4;
- `text`, `code`, `diagram`, or `comparison` where those semantics are accurate.

Baseline native formats include PNG/JPEG/WebP/SVG/GIF/WebM/MP4, JSON/CSV/TXT/Markdown/HTML, and IPYNB.

On capture, DemoWeave copies the file into an immutable snapshot under `.demoweave/evidence/artifacts/`, records `driver/research` provenance, then normal Flow fingerprinting adds the declared material `sources`. Do not list transient `outputs/...` files as Flow sources merely because they are capture inputs. Cleaning a disposable output directory should not make the immutable Evidence stale.

After a material source changes, use the normal freshness workflow. The generic `run-flow` regeneration path can rerun a stale research/notebook Flow once, and a second no-change update should perform zero actions.

The committed `fixtures/research` example demonstrates native SVG plot, CSV table, JSON metrics, and executed IPYNB Evidence. Its tiny Node notebook executor exists only to keep CI dependency-free; it is not a Jupyter implementation.

## Timeline composition workflow

`TimelinePlan v1` lives under `.demoweave/timelines/` and describes presentation only. It is separate from Flow v1.

Timeline panes may reference root-project Evidence IDs or safe project-relative PNG/GIF files. Static PNGs remain static; GIFs retain real animation.

```bash
demoweave compose <timeline-id-or-path> --format mp4
demoweave compose <timeline-id-or-path> --format gif
```

Use `--project <path>` or `--out <project-relative-path>` when needed. Composition requires FFmpeg and records derived compositor Evidence.

Current freshness analysis can explain changed compositor inputs, but `update --apply` does not yet invent automatic compose actions.

## Tutorial packaging workflow

`TutorialPlan v1` lives under `.demoweave/tutorials/` and packages an existing root-project MP4 Evidence source.

The agent authors:

- title and description;
- language and optional tags;
- caption text and explicit start/end timing;
- chapter titles and explicit start timing;
- thumbnail timestamp, dimensions, fit/background, and optional title/subtitle.

Build with:

```bash
demoweave tutorial build <tutorial-id-or-path>
demoweave tutorial build <tutorial-id-or-path> --project <path>
```

Use `--out-dir <project-relative-path>` only when overriding the configured tutorial package directory.

Tutorial build requires FFmpeg and `ffprobe`. DemoWeave validates project-local MP4 Evidence and timing, extracts a real source frame, applies deterministic SVG/resvg thumbnail text treatment, and writes:

```text
docs-media/tutorials/<tutorial-id>/
  <tutorial-id>.mp4
  <tutorial-id>-thumbnail.png
  <tutorial-id>.srt
  <tutorial-id>.vtt
  <tutorial-id>-chapters.txt
  <tutorial-id>-description.txt
  <tutorial-id>-youtube.json
```

The packaged MP4 preserves the source bytes. DemoWeave does not synthesize narration/TTS, upload to a platform, invent caption prose, or turn static screenshots into fake motion.

## Visual QA workflow

Visual QA is a two-stage agent/tool workflow. The generated packet is cache; the reviewed report is durable metadata.

### 1. Ensure the source Evidence is fresh

```bash
demoweave status .
```

Do not visually approve stale, missing, or unknown Evidence. Regenerate/resolve it first.

### 2. Prepare deterministic review material

```bash
demoweave qa prepare <evidence-id>
demoweave qa prepare <evidence-id> --samples 7 --project <path>
```

Current supported source formats are PNG, GIF, and MP4 Evidence.

`qa prepare` writes generated material under:

```text
.demoweave/cache/qa/<review-id>/
  frame-001.png
  ...
  contact-sheet.png
  packet.json
```

The `VisualQAPacket v1` binds:

- source Evidence ID/path/hash;
- dimensions and duration where applicable;
- deterministic uniform sample timestamps;
- hashes for every sample and the contact sheet;
- scene/caption context when source provenance exposes a TimelinePlan/TutorialPlan;
- advisory black/freeze ranges when detected.

It also creates a pending report template under `.demoweave/qa/reports/<review-id>.json` if one does not already exist. Re-preparing cache does not silently overwrite an existing agent report.

### 3. Actually inspect the images

Open the contact sheet and full-size frames where necessary. Review at minimum:

- readability;
- clipping/cropping;
- broken/loading states;
- visible secrets or machine-specific paths;
- dead time / unintended holds;
- caption/visual mismatch when caption context exists;
- composition and aspect ratio;
- text overlap;
- flicker or abrupt ending where visible from samples/signals.

A black/freeze signal is not itself a failure. For example, a deliberate final reading hold may be acceptable and should be recorded as an informational finding rather than removed blindly.

Do not claim OCR/secret scanning occurred unless a separate tool actually performed it. The current M10 workflow relies on agent visual inspection.

### 4. Author the durable VisualQAReport v1

Edit the pending report only after inspection. Set:

- `verdict`: `pass` or `needs-changes`;
- structured findings with stable IDs;
- severity (`info`, `warning`, `error`);
- category;
- clear message;
- relevant `sampleId` and/or time range where useful;
- optional recommendation.

A PASS report cannot contain error findings. NEEDS-CHANGES must contain at least one warning/error.

Do not alter the packet/source binding fields to make an old report fit new bytes.

### 5. Finalize against the exact reviewed bytes

```bash
demoweave qa finalize <review-id-or-path>
demoweave qa finalize <review-id-or-path> --project <path>
```

Finalization rechecks:

- report schema;
- exact packet ID/hash;
- exact source Evidence/artifact hash;
- current source bytes;
- every sampled frame hash;
- contact-sheet hash;
- finding sample/time references.

If anything changed, prepare and review again.

PASS records derived `agent/visual-qa` result Evidence and exits zero. NEEDS-CHANGES also records the review but exits non-zero so it can block CI/publication.

DemoWeave does not automatically fix the media after a finding. The agent decides the correction, reruns the relevant renderer/compositor/capture path, prepares a fresh packet, and reviews again.

## Freshness and selective update workflow

Explain current freshness:

```bash
demoweave status .
demoweave status . --json
```

Evidence is classified as `fresh`, `stale`, `missing`, or `unknown`, with explicit reasons. Derived Evidence propagates upstream state; local Markdown references are mapped to impacted documents.

Preview the minimal supported regeneration plan:

```bash
demoweave update .
demoweave update . --json
```

Apply only when wanted:

```bash
demoweave update . --apply
```

For stale web Flows with relative navigation, keep the app running and supply the runtime origin:

```bash
demoweave update . --apply --base-url http://127.0.0.1:3000
```

Current update planning supports known `run-flow` regeneration for executable source Evidence across terminal, web, research, and notebook surfaces plus supported terminal derivations. Compositor/tutorial rebuilds are explained by freshness but are not automatically scheduled yet. Do not treat `unknown` as permission to regenerate.

Finalized visual-QA report Evidence derives from its reviewed media source, so later source changes make the review stale through normal upstream propagation.

## Safe Markdown workflow

Inspect the exact target first:

```bash
demoweave docs inspect README.md
demoweave docs inspect docs/guide.md --json
```

The agent authors `DocumentPlan v1` under `.demoweave/plans/` using the exact base hash and inspected section IDs.

Supported operations:

- `preserve` — selected section must stay untouched;
- `edit` — replace only direct body, preserving heading/nested sections;
- `replace` — replace full section subtree;
- `create` — insert exact Markdown before/after an anchor or at document start/end;
- `remove` — remove selected subtree with a non-empty reason.

Preview without mutation:

```bash
demoweave docs preview .demoweave/plans/readme.json
```

Review the operation summary and unified diff. If content changes, preview again and use the new token.

Apply only the token that was actually reviewed:

```bash
demoweave docs apply .demoweave/plans/readme.json --review 'review-v1:<token>'
```

Discard an unwanted plan without touching its target:

```bash
demoweave docs discard .demoweave/plans/readme.json
```

## Current boundaries

Current executable surface drivers:

- **terminal** — non-interactive process/pipe execution + TerminalTrack capture;
- **web** — Playwright Chromium semantic interaction + PNG screenshot capture against an already-running app;
- **Windows desktop** — explicit-PID Windows UI Automation + top-level application-window PNG capture;
- **research / notebook** — explicit process execution + immutable native artifact capture; no environment inference or notebook-UI recording.

Current presentation/review tooling:

- terminal PNG/GIF rendering;
- TimelinePlan MP4/GIF composition over local PNG/GIF media;
- TutorialPlan package generation from existing MP4 Evidence;
- VisualQAPacket/VisualQAReport agent-reviewed QA for fresh PNG/GIF/MP4 Evidence.

Not yet available:

- interactive PTY input;
- browser interaction GIF/video recording;
- macOS/Linux desktop or native mobile capture;
- Windows desktop scrolling or element capture;
- narration/TTS generation;
- publishing/upload integration;
- OCR-based secret detection;
- automatic visual fixes.

Current metadata layout:

```text
.demoweave/
  config.json
  project.json              # generated; do not commit
  flows/
    <flow>.json
  timelines/
    <timeline>.json
  tutorials/
    <tutorial>.json
  plans/
    <document-plan>.json
  qa/
    reports/
      <review-id>.json      # durable agent-authored VisualQAReport
  cache/
    qa/
      <review-id>/          # generated packet, frames, contact sheet
  evidence/
    manifest.json
    artifacts/
      <evidence-id>.terminal.json
      <evidence-id>.png
      <evidence-id>.svg
      <evidence-id>.csv
      <evidence-id>.json
      <evidence-id>.ipynb
docs-media/
  <terminal-evidence-id>.png
  <terminal-evidence-id>.gif
  <timeline-id>.mp4
  <timeline-id>.gif
  tutorials/
    <tutorial-id>/
      <tutorial-id>.mp4
      <tutorial-id>-thumbnail.png
      <tutorial-id>.srt
      <tutorial-id>.vtt
      <tutorial-id>-chapters.txt
      <tutorial-id>-description.txt
      <tutorial-id>-youtube.json
```

Published contracts live under `schemas/`:

- `project.schema.json`
- `flow.schema.json`
- `evidence.schema.json`
- `manifest.schema.json`
- `terminal-track.schema.json`
- `document-plan.schema.json`
- `timeline.schema.json`
- `tutorial.schema.json`
- `visual-qa.schema.json`
- `freshness-report.schema.json`
