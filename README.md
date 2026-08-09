# DemoWeave

DemoWeave is an agent-native documentation studio for software repositories.

The long-term goal is to let Claude Code or Codex understand a project, run the surfaces users interact with, collect real evidence, and produce clean written and visual documentation: READMEs, guides, screenshots, GIFs, and full tutorials.

DemoWeave is designed for more than websites. A repository may expose web, CLI, desktop, mobile, library/SDK, notebook, research, and other surfaces at the same time.

> M0–M2 are complete. DemoWeave is currently building M3: the first real terminal runtime driver. See [ROADMAP.md](./ROADMAP.md) for the exact current step and exit criteria.

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

DemoWeave currently provides deterministic project analysis plus platform-neutral workflow/evidence contracts:

```bash
demoweave doctor
demoweave init .
demoweave inspect .
demoweave status .
demoweave validate .
```

Frozen compatibility baselines now include:

- `ProjectProfile v1`
- `Flow v1`
- `Evidence v1`
- `Manifest v1`
- `SurfaceDriver v1`

The analyzer records ecosystem-neutral repository facts and baseline component/workspace information for Node, Python, Rust, and Go projects while allowing one repository to expose multiple surfaces. Flow v1 describes semantic actions without baking in Playwright, Appium, terminal-recorder, or renderer-specific implementation details.

No external LLM API is required for the core. Claude Code/Codex are the intelligence layer; DemoWeave provides deterministic project inspection, execution, evidence capture, rendering, validation, and provenance tooling as those milestones land.

### Component discovery boundary

ProjectProfile v1 records supported manifests anywhere in the repository as components. To avoid presenting fixtures and examples as user-facing surfaces, automatic surface detection is currently limited to repository-root components and members of a workspace declared at the repository root. Other nested components remain visible as deterministic facts and can gain explicit surface-selection semantics later without changing the component model.

## Current development target

M3 will make DemoWeave execute its own terminal Flow and produce a clean structured terminal Evidence track. Rendering that track to a README GIF belongs to M4, immediately after M3.
