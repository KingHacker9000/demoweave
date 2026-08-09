# M6 freshness model

M6 keeps freshness deterministic and explainable.

- Flow files may declare project-relative source dependencies.
- Successful Flow execution snapshots SHA-256 hashes for the Flow, declared sources, and produced source Evidence artifacts.
- Rendered Evidence inherits the source provenance and CLI rendering snapshots the rendered artifact hash.
- Freshness analysis compares current bytes with those snapshots. Older Evidence without snapshots may fall back to its recorded git commit; if that baseline is unavailable, freshness is `unknown`, never guessed stale or fresh.
- Derived Evidence propagates missing/stale/unknown upstream state.
- Markdown links to affected Evidence paths identify impacted documents without implying that the document itself must be rewritten.
- The regeneration plan deduplicates Flow runs, then schedules only stale/missing derived renders.
- `demoweave status` explains the chain without mutating files.
- `demoweave update` is a dry run by default; `--apply` executes the computed plan.
- If everything is fresh, `update --apply` performs zero actions and therefore creates no artifact/document churn.
