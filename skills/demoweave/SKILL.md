# DemoWeave Skill

Use DemoWeave when the user asks to create, improve, update, or validate documentation for a software repository.

## Principles

- Treat the repository as potentially multi-surface: web, CLI, desktop, mobile, library/SDK, notebook, research, service, or combinations of these.
- Use DemoWeave for deterministic inspection, execution, evidence capture, rendering, validation, and provenance.
- Use your own repository tools to understand intent, architecture, and which workflows actually matter.
- Do not generate visual media merely to decorate a document. Capture evidence only when it improves comprehension.
- Preserve useful existing documentation. Prefer intentional section-level edits over rewriting files wholesale.
- Never assume `/docs` is the only output. README.md and arbitrary Markdown files are first-class targets.

## Current M0/M1 workflow

1. Run `demoweave doctor` when environment readiness matters.
2. Run `demoweave init` if `.demoweave/config.json` does not exist.
3. Run `demoweave inspect .` to create `.demoweave/project.json`.
4. Read the resulting ProjectProfile together with the repository itself.
5. Reason about the project's actual user-facing surfaces and documentation needs.
6. Run `demoweave validate` before relying on generated DemoWeave metadata.

## Future workflow

As later milestones land, this same skill will direct the agent through Flow creation, evidence capture, Markdown planning/patching, stale detection, and tutorial rendering. Do not invent unsupported commands; inspect `demoweave --help` first.
