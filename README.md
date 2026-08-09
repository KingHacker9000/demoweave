# DemoWeave

DemoWeave is an agent-native documentation studio for software repositories.

The long-term goal is to let Claude Code or Codex understand a project, run the surfaces users interact with, collect real evidence, and produce clean written and visual documentation: READMEs, guides, screenshots, GIFs, and full tutorials.

DemoWeave is designed for more than websites. A repository may expose web, CLI, desktop, mobile, library/SDK, notebook, research, and other surfaces at the same time.

> This repository is currently in the M0/M1 bootstrap phase. See [ROADMAP.md](./ROADMAP.md) for the full plan.

## Development

Requirements:

- Node.js 20+
- pnpm

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

After building, the CLI package exposes:

```bash
pnpm --filter @demoweave/cli exec demoweave --help
```

## Current target

The first milestone is a deterministic project analyzer:

```bash
demoweave doctor
demoweave init
demoweave inspect .
demoweave status
demoweave validate
```

No external LLM API is required for the core analyzer. Claude Code/Codex will be the intelligence layer; DemoWeave provides deterministic project inspection, execution, evidence capture, rendering, validation, and provenance tooling.

### M1 component discovery boundary

ProjectProfile v1 records supported manifests anywhere in the repository as components. To avoid presenting fixtures and examples as user-facing surfaces, automatic surface detection is currently limited to repository-root components and members of a workspace declared at the repository root. Other nested components remain visible as deterministic facts and can gain explicit surface-selection semantics in a later milestone without changing the component model.
