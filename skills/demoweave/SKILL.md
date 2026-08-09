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
8. Every `capture` step references an `evidenceId`. Index that Evidence in `.demoweave/evidence/manifest.json` and keep its kind consistent with the capture step.
9. Record useful provenance on Evidence: Flow/step/surface when applicable, source dependencies, and Git commit when known.
10. Run `demoweave validate .` after editing DemoWeave metadata. Fix schema and cross-reference errors before relying on the Flow/manifest.

## M2 boundaries

M2 defines contracts only. The repository does not yet contain runtime PTY, browser, desktop, mobile, or media rendering drivers. A valid Flow describes what should happen; it does not imply that the current build can execute every step yet.

Current metadata layout:

```text
.demoweave/
  config.json
  project.json              # generated; do not commit
  flows/
    <flow>.json
  evidence/
    manifest.json
```

Published contracts live under `schemas/`:

- `project.schema.json`
- `flow.schema.json`
- `evidence.schema.json`
- `manifest.schema.json`

As later milestones land, this same skill will direct execution, capture, Markdown planning/patching, stale detection, and tutorial rendering without changing the core agent-vs-tool boundary.
