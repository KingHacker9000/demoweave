# DemoWeave

DemoWeave is an agent-native documentation studio for software repositories.

The long-term goal is to let Claude Code or Codex understand a project, run the surfaces users interact with, collect real evidence, and produce clean written and visual documentation: READMEs, guides, screenshots, GIFs, and full tutorials.

DemoWeave is designed for more than websites. A repository may expose web, CLI, desktop, mobile, library/SDK, notebook, research, and other surfaces at the same time.

> M0/M1 are complete. DemoWeave is currently building M2: the platform-neutral Flow, Evidence, and Manifest contracts. See [ROADMAP.md](./ROADMAP.md) for the full plan and current next step.

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

## Current capabilities

DemoWeave currently provides a deterministic project analyzer:

```bash
demoweave doctor
demoweave init
demoweave inspect .
demoweave status
demoweave validate
```

`ProjectProfile v1` is frozen as the M1 compatibility baseline. The analyzer records ecosystem-neutral repository facts and baseline component/workspace information for Node, Python, Rust, and Go projects while allowing one repository to expose multiple surfaces.

No external LLM API is required for the core analyzer. Claude Code/Codex are the intelligence layer; DemoWeave provides deterministic project inspection, execution, evidence capture, rendering, validation, and provenance tooling as those milestones land.

### Component discovery boundary

ProjectProfile v1 records supported manifests anywhere in the repository as components. To avoid presenting fixtures and examples as user-facing surfaces, automatic surface detection is currently limited to repository-root components and members of a workspace declared at the repository root. Other nested components remain visible as deterministic facts and can gain explicit surface-selection semantics later without changing the component model.
