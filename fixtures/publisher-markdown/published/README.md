# Markdown publisher fixture

Read the [getting started guide](guide/getting-started.md?mode=quick#first-run).

![Deterministic proof](docs-media/proof.svg)

The remote [DemoWeave repository](https://github.com/KingHacker9000/demoweave) remains unchanged and is never fetched.

## What this proves

`.demoweave/publishers/markdown-proof.json` explicitly maps this file to `published/README.md` and `docs/getting-started.md` to `published/guide/getting-started.md`. Preview rewrites the guide link relative to its destination, copies `docs-media/proof.svg`, leaves the remote URL unchanged, and performs no writes. Reviewed apply preserves the unrelated `published/keep-me.txt` and records `.demoweave/publications/markdown-proof.json`.

```bash
node packages/cli/dist/index.js publish preview markdown-proof --project fixtures/publisher-markdown
node packages/cli/dist/index.js publish apply markdown-proof \
  --project fixtures/publisher-markdown \
  --review-token 'publish-review-v1:<reviewed-token>'
node packages/cli/dist/index.js publish status markdown-proof --project fixtures/publisher-markdown
```

The committed target and manifest form a coherent fresh baseline. The M15A smoke copies this fixture to a temporary directory before testing stale source/dependency inputs, target drift/missing output, unresolved local Markdown, stale tokens, source-byte preservation, and zero-write/no-churn reapply.
