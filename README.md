# DemoWeave

DemoWeave is an agent-native documentation studio for software repositories.

The goal is to let Claude Code or Codex understand a project, run the surfaces users interact with, collect real runtime evidence, and produce clean written + visual documentation: READMEs, guides, screenshots, GIFs, and full tutorials.

DemoWeave is designed for more than websites. A repository may expose web, CLI, desktop, mobile, library/SDK, notebook, research, and other surfaces at the same time.

> M0–M3 are complete. DemoWeave can now analyze a repository, execute terminal Flows, and capture structured terminal Evidence with provenance. **M4 is building the lightweight renderer that turns that Evidence into the first polished PNG/GIF.** See [ROADMAP.md](./ROADMAP.md).

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

```bash
demoweave doctor
demoweave init .
demoweave inspect .
demoweave status .
demoweave validate .
demoweave run <flow-id-or-path>
```

Current compatibility/runtime contracts include:

- `ProjectProfile v1`
- `Flow v1`
- `Evidence v1`
- `Manifest v1`
- `SurfaceDriver v1`
- `TerminalTrack v1`

The analyzer records ecosystem-neutral repository facts for Node, Python, Rust, and Go projects while allowing one repository to expose multiple surfaces. Flow v1 describes semantic actions without baking in Playwright, Appium, terminal-recorder, or renderer-specific implementation details.

The first real driver is terminal-native. DemoWeave executes non-interactive CLI workflows through lightweight process pipes rather than recording the user's personal terminal window. Captures preserve ordered input/stdout/stderr events and ANSI output in a renderer-independent TerminalTrack, then update Evidence/Manifest provenance atomically.

The repository dogfoods this already:

```bash
node packages/cli/dist/index.js inspect .
node packages/cli/dist/index.js run inspect-project
```

The committed `inspect-project` Flow runs DemoWeave against its own repository, checks the result, and captures `.demoweave/evidence/artifacts/inspect-project-terminal.terminal.json`.

No external LLM API is required for the core. Claude Code/Codex are the intelligence layer; DemoWeave provides deterministic inspection, execution, evidence capture, rendering, validation, and provenance tooling.

### Component discovery boundary

ProjectProfile v1 records supported manifests anywhere in the repository as components. To avoid presenting fixtures and examples as user-facing surfaces, automatic surface detection is currently limited to repository-root components and members of a workspace declared at the repository root. Other nested components remain visible as deterministic facts and can gain explicit surface-selection semantics later without changing the component model.

## Current development target

**M4: TerminalTrack → polished PNG/GIF.**

The renderer will consume the already-captured terminal Evidence, replay it into a controlled DemoWeave terminal presentation, generate a clean PNG, encode a Markdown-friendly animated GIF with FFmpeg, and register those outputs as derived Evidence. No OBS and no desktop recording.

README embedding itself is the next checkpoint, **Pilot P0 — DemoWeave documents DemoWeave**.
