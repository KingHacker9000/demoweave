# DemoWeave Skill

Use DemoWeave when the user asks to create, improve, update, or validate documentation for a software repository.

## Principles

- Treat the repository as potentially multi-surface: web, CLI, desktop, mobile, library/SDK, notebook, research, service, or combinations of these.
- Use DemoWeave for deterministic inspection, execution, evidence capture, rendering, freshness analysis, Markdown patch review, validation, and provenance.
- Use your own repository tools to understand intent, architecture, and which workflows actually matter.
- Do not generate visual media merely to decorate a document. Capture evidence only when it improves comprehension.
- Preserve useful existing documentation. Prefer intentional section-level edits over rewriting files wholesale.
- Never assume `/docs` is the only output. README.md and arbitrary Markdown files are first-class targets.
- DemoWeave does not write the prose for you. The agent authors Markdown; DemoWeave deterministically inspects, previews, reviews, and applies it.
- Treat `unknown` freshness as unresolved information, not permission to regenerate. Never invent a baseline or silently classify it as fresh/stale.
- Prefer the minimal regeneration plan from DemoWeave over manually rerunning the whole evidence pipeline.
- Keep runtime/browser configuration out of Flow v1. Do not embed Playwright selectors, scripts, browser launch settings, Appium instructions, shell-recorder commands, or renderer-specific details in a Flow.
- Do not invent DemoWeave commands or Flow actions. Check `demoweave --help` and the published schemas before using them.

## Repository and evidence workflow

1. Run `demoweave doctor` when environment readiness matters.
2. Run `demoweave init .` if DemoWeave metadata has not been initialized.
3. Run `demoweave inspect .` to produce the generated `.demoweave/project.json` ProjectProfile.
4. Read ProjectProfile together with the repository itself. ProjectProfile contains facts; use repository tools to reason about which workflows actually matter to users.
5. When a workflow needs to be demonstrated, create a JSON Flow v1 file under `.demoweave/flows/`.
6. Set `surfaceId` to an existing stable surface ID from `.demoweave/project.json`.
7. Declare project-relative `sources` on the Flow when specific implementation/config/fixture/data/asset files materially determine the captured result. Do not invent broad source lists just to populate provenance.
8. Use semantic Flow actions such as `run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture` as appropriate for the selected surface.
9. Execute the Flow with the surface-specific runtime guidance below.
10. A successful capture updates `.demoweave/evidence/manifest.json` and fingerprints the Flow, declared sources, and produced artifact for later freshness checks. Existing Evidence-level source provenance is preserved.
11. Run `demoweave validate .` after editing, executing, rendering, or adding DemoWeave metadata. Fix schema and cross-reference errors before relying on the output.

## Terminal Flow workflow

Run a terminal Flow with:

```bash
demoweave run <flow-id-or-path>
demoweave run <flow-id-or-path> --project <path>
```

The current terminal driver executes non-interactive process/pipe workflows. It supports `run`, duration/process-exit/file-exists waits, output/exit-code/file-exists assertions, and terminal capture. A `run` expects exit code `0` unless its optional `expectedExitCodes` declares another accepted integer result. Unsupported terminal actions fail explicitly.

A successful terminal `capture` writes:

```text
.demoweave/evidence/artifacts/<evidence-id>.terminal.json
```

Render terminal Evidence with:

```bash
demoweave render <evidence-id-or-path> --format png
demoweave render <evidence-id-or-path> --format gif
```

PNG rendering is built in. GIF rendering additionally requires FFmpeg reported by `demoweave doctor`. CLI rendering fingerprints the derived artifact.

## Web Flow workflow

M7 implements Flow v1 against `web` surfaces with Playwright Chromium.

### 1. Check browser readiness

```bash
demoweave doctor
```

If Chromium is not installed in a source checkout:

```bash
pnpm --filter @demoweave/drivers exec playwright install chromium
```

On Linux systems that also need Playwright's browser system dependencies, use the supported Playwright installation form with `--with-deps chromium`.

### 2. Start the application separately

The web driver does not guess how to start an arbitrary repository or choose a port. Start the web application with its real project command, wait until it is reachable, and keep that process alive while DemoWeave executes the Flow.

Do not put the application startup command, localhost origin, or Playwright launch configuration into Flow v1 merely to make a browser run work.

### 3. Run the semantic Flow

Relative `navigate` destinations require an explicit runtime base URL:

```bash
demoweave run <flow-id-or-path> --base-url http://127.0.0.1:3000
```

Use `--project <path>` when needed. For local debugging only, `--headed` shows Chromium:

```bash
demoweave run <flow-id-or-path> --base-url http://127.0.0.1:3000 --headed
```

Absolute HTTP/HTTPS `navigate` destinations do not require `--base-url`. Do not guess an origin if the Flow uses relative navigation and none was provided.

### 4. Use semantic browser actions and targets

Current web-driver actions:

- `navigate`
- `activate`
- `input`
- `press`
- `scroll`
- supported `wait`
- supported `assert`
- `capture` with `kind: "screenshot"`

Current target strategies are translated by the driver:

- `text`
- `label`
- `role`
- `name`
- `testId`
- `accessibilityId`
- `automationId`

Prefer stable semantic targets (`role`, `label`, test/automation IDs) over brittle visible text when the repository already exposes them. Playwright strictness is intentional: ambiguous interactions should fail rather than silently choosing an arbitrary element.

Current web waits cover duration, visible, hidden, and text conditions. Current web assertions cover visible, hidden, and text-contains checks. Terminal-only wait/assertion kinds fail explicitly on a web surface.

### 5. Capture screenshot Evidence

A successful web screenshot capture writes:

```text
.demoweave/evidence/artifacts/<evidence-id>.png
```

The manifest records `driver/web` provenance. The normal post-Flow snapshot fingerprints the producing Flow, declared sources, and PNG bytes, so `status` and document-impact analysis use the same M6 freshness model as terminal Evidence.

M7 does **not** implement browser interaction GIF/video recording. Do not claim or fabricate animated browser Evidence. That remains later roadmap work.

## Timeline composition workflow

M8 composes existing local Evidence/media through a persistent presentation-only `TimelinePlan v1` under `.demoweave/timelines/`. Timeline plans are separate from Flow v1: Flows capture factual source evidence, while timelines describe canvas dimensions, frame rate, scene duration/order, single or horizontal split layout, pane sources, and `contain`/`cover` fit.

Timeline pane sources may reference either:

- root-project Evidence by `evidenceId`; or
- a project-relative PNG/GIF file by `path`.

File sources must remain inside the project. URLs, absolute paths, traversal, symlink escapes, and unsupported formats are rejected. Static PNG sources remain static; animated GIF sources retain their animation. Composition requires FFmpeg but does not require a browser, Chromium, OBS, or desktop capture.

Compose through the one public command:

```bash
demoweave compose <timeline-id-or-path> --format mp4
demoweave compose <timeline-id-or-path> --format gif
```

Use `--project <path>` when needed and `--out <project-relative-path>` to override the configured `mediaDir` destination. A successful compose records `<timeline-id>-mp4` or `<timeline-id>-gif` as derived recording Evidence. Root-manifest Evidence sources appear in `derivedFrom`; the timeline file and direct file sources appear as SHA-256 provenance sources. Current freshness analysis can detect those changes, but selective `update --apply` does not yet schedule composition regeneration.

## Freshness and selective update workflow

Use M6 before manually regenerating existing Evidence or media.

### 1. Explain current freshness

```bash
demoweave status .
demoweave status . --json
```

Evidence is classified as:

- `fresh` — current bytes match available provenance fingerprints/baselines;
- `stale` — a concrete dependency, Flow, artifact, or upstream Evidence changed;
- `missing` — a required artifact/dependency is absent;
- `unknown` — DemoWeave lacks enough baseline information to decide safely.

Read the reason chain. Derived Evidence propagates upstream stale/missing/unknown state. DemoWeave also reports Markdown files that link to affected Evidence paths.

Do not mutate anything merely because a document is listed as impacted. An impacted document may only need its referenced asset regenerated, not prose changes.

### 2. Preview the minimal regeneration plan

```bash
demoweave update .
demoweave update . --json
```

`update` is a dry run unless `--apply` is supplied. Review the computed actions before execution. Current planning deduplicates stale source Evidence into one producing Flow run per Flow, then schedules supported derived renders.

If an item is `unknown`, resolve the missing baseline/dependency information first or make an explicit human/agent decision. DemoWeave deliberately does not auto-regenerate unknown state.

For a web Flow that requires runtime context such as a base URL or a separately running application, ensure that context exists before applying any plan that would rerun it. Do not invent the runtime origin.

### 3. Apply only when wanted

```bash
demoweave update . --apply
```

After apply, DemoWeave re-analyzes freshness. Check the result rather than assuming regeneration succeeded.

If a dry run reports zero actions, do not manually rerun the Flow/render pipeline. A no-change `update --apply` should also execute zero actions and create no artifact/document churn.

## Safe Markdown workflow

When changing an existing Markdown document, do not blindly overwrite the file. Use the M5 review workflow unless the user explicitly asks for a different editing mechanism.

### 1. Inspect the exact target

```bash
demoweave docs inspect README.md
demoweave docs inspect docs/guide.md --json
```

Inspection returns:

- the project-relative target path;
- a SHA-256 base hash;
- newline/trailing-newline facts;
- the preamble region;
- deterministic section IDs, heading paths, levels, and source ranges.

Section IDs disambiguate duplicate heading text. Heading-looking text inside fenced code blocks is not a section.

### 2. Author a DocumentPlan v1

Create the plan under `.demoweave/plans/`, using the exact `baseHash` and section IDs from inspection. The agent supplies all Markdown content.

Supported operations:

- `preserve` — assert that a selected section must remain untouched;
- `edit` — replace only the selected section's direct body while preserving its heading and nested child sections;
- `replace` — replace the selected section's complete source range;
- `create` — insert exact Markdown `before` or `after` a selected anchor, or at document start/end;
- `remove` — remove a selected section and include a non-empty reason.

Example:

```json
{
  "schemaVersion": 1,
  "id": "readme-quickstart",
  "targetPath": "README.md",
  "baseHash": "sha256:<hash from inspect>",
  "operations": [
    {
      "id": "keep-overview",
      "type": "preserve",
      "selector": { "sectionId": "<section id>" }
    },
    {
      "id": "edit-quickstart",
      "type": "edit",
      "selector": { "sectionId": "<section id>" },
      "markdown": "Updated body Markdown exactly as it should appear.\n"
    }
  ]
}
```

Do not guess section IDs or base hashes. Re-inspect after external document changes.

### 3. Preview before asking to apply

```bash
demoweave docs preview .demoweave/plans/readme-quickstart.json
```

Preview does not mutate the target. It prints the operation summary, unified diff, candidate hash, and deterministic `review-v1:...` token. Use `--candidate` when the complete resulting document is useful for review, or `--json` for the full structured preview.

Review the diff yourself and surface it to the user when approval is required. If the content needs refinement, edit the plan and preview again; the review token will change.

### 4. Apply only the reviewed token

```bash
demoweave docs apply .demoweave/plans/readme-quickstart.json --review 'review-v1:<token>'
```

Apply is atomic and refuses when:

- the target no longer matches the plan base hash;
- the plan changed after preview;
- the candidate changed;
- the supplied review token does not match;
- selectors conflict/overlap;
- a mutation would violate an explicit `preserve` operation;
- a project path escapes the repository or resolves through a rejected symlink.

Never substitute a newly generated token for the token that was actually reviewed.

### 5. Discard when a plan is not wanted

```bash
demoweave docs discard .demoweave/plans/readme-quickstart.json
```

Discard deletes the plan only. It never changes the target Markdown document.

## Current execution and rendering boundaries

DemoWeave currently has two executable surface drivers:

- **terminal** — non-interactive process/pipe execution and renderer-independent TerminalTrack capture;
- **web** — Playwright Chromium semantic interaction and PNG screenshot capture against an already-running/reachable web application.

The terminal renderer turns TerminalTrack v1 into PNG or GIF without a browser runtime. The M8 compositor turns local PNG/GIF Evidence and project-relative media into deterministic single/split MP4 or GIF scenes. FFmpeg is required for GIF rendering and all timeline composition. Browser screenshots remain static when composed; composition does not turn them into browser recordings.

Interactive PTY input, browser video/GIF recording, desktop capture, native mobile capture, research/notebook drivers, narration, captions, chapters, and full tutorial generation are not available yet.

Current metadata layout:

```text
.demoweave/
  config.json
  project.json              # generated; do not commit
  flows/
    <flow>.json
  timelines/
    <timeline>.json
  plans/
    <document-plan>.json
  evidence/
    manifest.json
    artifacts/
      <evidence-id>.terminal.json
      <evidence-id>.png
docs-media/                  # configured rendered-media directory
  <terminal-evidence-id>.png
  <terminal-evidence-id>.gif
  <timeline-id>.mp4
  <timeline-id>.gif
```

Published contracts live under `schemas/`:

- `project.schema.json`
- `flow.schema.json`
- `evidence.schema.json`
- `manifest.schema.json`
- `terminal-track.schema.json`
- `document-plan.schema.json`
- `timeline.schema.json`
- `freshness-report.schema.json`
