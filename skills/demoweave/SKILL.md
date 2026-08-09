# DemoWeave Skill

Use DemoWeave when the user asks to create, improve, update, or validate documentation for a software repository.

## Principles

- Treat the repository as potentially multi-surface: web, CLI, desktop, mobile, library/SDK, notebook, research, service, or combinations of these.
- Use DemoWeave for deterministic inspection, execution, evidence capture, rendering, Markdown patch review, validation, and provenance.
- Use your own repository tools to understand intent, architecture, and which workflows actually matter.
- Do not generate visual media merely to decorate a document. Capture evidence only when it improves comprehension.
- Preserve useful existing documentation. Prefer intentional section-level edits over rewriting files wholesale.
- Never assume `/docs` is the only output. README.md and arbitrary Markdown files are first-class targets.
- DemoWeave does not write the prose for you. The agent authors Markdown; DemoWeave deterministically inspects, previews, reviews, and applies it.
- Do not invent DemoWeave commands or Flow actions. Check `demoweave --help` and the published schemas before using them.

## Repository and evidence workflow

1. Run `demoweave doctor` when environment readiness matters.
2. Run `demoweave init .` if DemoWeave metadata has not been initialized.
3. Run `demoweave inspect .` to produce the generated `.demoweave/project.json` ProjectProfile.
4. Read ProjectProfile together with the repository itself. ProjectProfile contains facts; use your repository tools to reason about which workflows actually matter to users.
5. When a workflow needs to be demonstrated, create a JSON Flow v1 file under `.demoweave/flows/`.
6. Set `surfaceId` to an existing stable surface ID from `.demoweave/project.json`.
7. Use semantic Flow actions such as `run`, `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture`. Do not embed Playwright, Appium, shell-recorder, or renderer-specific instructions in the Flow.
8. Run a terminal Flow with `demoweave run <flow-id-or-path>`. Use `--project <path>` when the project root is not the current directory.
9. A successful terminal `capture` writes `.demoweave/evidence/artifacts/<evidence-id>.terminal.json` and updates `.demoweave/evidence/manifest.json` with driver and Git provenance.
10. Record real source dependencies on planned Evidence when they are known; execution preserves them. Do not invent dependencies just to populate provenance.
11. Render terminal Evidence with `demoweave render <evidence-id-or-path> --format png` or `demoweave render <evidence-id-or-path> --format gif`. PNG rendering is built in; GIF rendering additionally requires FFmpeg reported by `demoweave doctor`.
12. Run `demoweave validate .` after editing, executing, rendering, or adding DemoWeave metadata. Fix schema and cross-reference errors before relying on it.

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
- `edit` — replace only the selected section body while preserving its heading line;
- `replace` — replace the selected section's complete source range;
- `create` — insert exact Markdown `before` or `after` a selected anchor;
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

## Current terminal execution and rendering boundaries

DemoWeave executes non-interactive terminal Flows through a process/pipe session. It supports `run`, duration/process-exit/file-exists waits, output/exit-code/file-exists assertions, and terminal capture. A `run` expects exit code `0` unless its optional `expectedExitCodes` declares another accepted integer result. Unsupported terminal actions fail explicitly. The renderer turns TerminalTrack v1 into PNG or GIF without a browser runtime; GIF encoding requires optional FFmpeg. Interactive PTY input and browser/desktop/mobile capture are not available yet.

Current metadata layout:

```text
.demoweave/
  config.json
  project.json              # generated; do not commit
  flows/
    <flow>.json
  plans/
    <document-plan>.json
  evidence/
    manifest.json
    artifacts/
      <evidence-id>.terminal.json
docs-media/                  # or configured mediaDir
  <evidence-id>.png
  <evidence-id>.gif
```

Published contracts live under `schemas/`:

- `project.schema.json`
- `flow.schema.json`
- `evidence.schema.json`
- `manifest.schema.json`
- `terminal-track.schema.json`
- `document-plan.schema.json`

M6 will add stale/provenance tracking. Do not pretend M5 already performs automatic stale-evidence regeneration.
