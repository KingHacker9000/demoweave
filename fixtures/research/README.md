# Research / notebook fixture

This fixture proves DemoWeave's M11 research path with **native artifacts rather than screenshots of notebook UI**.

It exposes two surfaces detected by `demoweave inspect`:

- `research-research-workflow` — an explicit experiment script that writes an SVG learning curve, CSV result table, and JSON metrics.
- `notebook-notebooks` — an explicit notebook execution command that writes an executed `.ipynb` artifact with captured cell output.

From the DemoWeave repository root:

```bash
node packages/cli/dist/index.js inspect fixtures/research
node packages/cli/dist/index.js run research-results --project fixtures/research
node packages/cli/dist/index.js run notebook-results --project fixtures/research
node packages/cli/dist/index.js status fixtures/research
node packages/cli/dist/index.js validate fixtures/research
```

The Flows capture immutable snapshots under `.demoweave/evidence/artifacts/`:

| Evidence | Kind | Native format |
|---|---|---|
| `research-learning-curve` | plot | SVG |
| `research-results-table` | table | CSV |
| `research-metrics` | result | JSON |
| `research-executed-notebook` | result | IPYNB |

`capture.artifact.path` is the only M11 addition to Flow v1. The research driver runs only commands declared by the Flow, then copies the declared project-local artifact into Evidence with hashes and provenance. It does not infer an environment, install Python/Jupyter, or record notebook chrome.

The tiny `notebooks/execute.mjs` program exists only to keep this fixture cross-platform and dependency-free while proving that notebook execution is an **explicit repository command**. It is not a Jupyter implementation. A real project can instead declare its own `jupyter`, `uv`, `python`, `poetry`, R, Julia, MATLAB, or other execution command and capture the files that command actually produces.

CI runs this fixture on Ubuntu and Windows, mutates the experiment source, checks that only the three research outputs become stale, repairs them with one `run-flow` regeneration action, then verifies a second update performs zero actions and changes no Evidence bytes.
