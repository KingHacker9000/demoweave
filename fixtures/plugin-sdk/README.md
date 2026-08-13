# M14 external plugin fixture

This fixture is loaded only through `.demoweave/config.json`. Its local package imports the workspace-only `@demoweave/sdk`, contributes a `service` surface, writes JSON Evidence through the host Evidence service, and converts that real result into a deterministic SVG documentation card through `fixture-service-card`.

```bash
node packages/cli/dist/index.js render plugin-service-result \
  --project fixtures/plugin-sdk \
  --format svg \
  --renderer plugin/fixture-service/fixture-service-card
```

The host writes and tracks the reviewed [`docs-media/plugin-service-result-fixture-service-card-svg.svg`](docs-media/plugin-service-result-fixture-service-card-svg.svg), records its renderer producer identity, plugin fingerprint, and artifact hash, and derives it from `plugin-service-result`.

DemoWeave plugins are trusted Node.js code with the same process privileges as the CLI. They are not sandboxed, auto-discovered, or installed by DemoWeave.
