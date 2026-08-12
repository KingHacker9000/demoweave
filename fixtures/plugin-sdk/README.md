# M14A external plugin fixture

This fixture is loaded only through `.demoweave/config.json`. Its local package imports the workspace-only `@demoweave/sdk`, contributes a `service` surface, and writes JSON Evidence through the host Evidence service.

DemoWeave plugins are trusted Node.js code with the same process privileges as the CLI. They are not sandboxed, auto-discovered, or installed by DemoWeave.
