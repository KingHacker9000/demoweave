# DemoWeave Skill

Use DemoWeave when the user asks to create, improve, update, or validate documentation for a software repository.

## Principles

- Treat the repository as potentially multi-surface: web, CLI, desktop, mobile, library/SDK, notebook, research, service, or combinations of these.
- Use DemoWeave for deterministic inspection, execution, evidence capture, rendering, validation, and provenance.
- Use your own repository tools to understand intent, architecture, and which workflows actually matter.
- Do not generate visual media merely to decorate a document. Capture evidence only when it improves comprehension.
- Preserve useful existing documentation. Prefer intentional section-level edits over rewriting files wholesale.
- Never assume `/docs` is the only output. README.md and arbitrary Markdown files are first-class targets.
- Do not invent DemoWeave commands or Flow actions. Check `demoweave --help` and the published schemas before using them.

## Current workflow

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
11. Render terminal Evidence with `demoweave render <evidence-id-or-path> --format png` or `demoweave render <evidence-id-or-path> --format gif`. Use `--project <path>` when needed. PNG rendering is built in; GIF rendering additionally requires FFmpeg reported by `demoweave doctor`.
12. Rendered Evidence uses the configured `.demoweave/config.json` `mediaDir`, derives from the source terminal Evidence, and is indexed in Manifest v1. A direct TerminalTrack path can also be rendered, but only indexed source Evidence produces a derived manifest entry.
13. Run `demoweave validate .` after editing, executing, or rendering DemoWeave metadata. Fix schema and cross-reference errors before relying on the Flow/manifest.

## Current terminal execution and rendering boundaries

DemoWeave executes non-interactive terminal Flows through a process/pipe session. It supports `run`, duration/process-exit/file-exists waits, output/exit-code/file-exists assertions, and terminal capture. A `run` expects exit code `0` unless its optional `expectedExitCodes` declares another accepted integer result. Unsupported terminal actions fail explicitly. The M4 renderer turns TerminalTrack v1 into PNG or GIF without a browser runtime; GIF encoding requires optional FFmpeg. Interactive PTY input and browser/desktop/mobile capture are not available yet.

Current metadata layout:

```text
.demoweave/
  config.json
  project.json              # generated; do not commit
  flows/
    <flow>.json
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

As later milestones land, this same skill will direct Markdown planning/patching, stale detection, and tutorial composition without changing the core agent-vs-tool boundary.
