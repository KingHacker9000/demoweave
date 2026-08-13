# M14B — Renderer plugin integration

Status: implementation contract for `feat/m14b-renderer-plugins`.

M14A established explicit trusted plugins, detector contributions, driver factories, host-owned capture Evidence, and plugin fingerprints. M14B completes M14 by adding an external renderer contribution without changing Flow v1 or starting publisher runtime work.

## Goal

A configured trusted plugin should be able to transform existing DemoWeave Evidence into a derived documentation artifact through the normal `demoweave render` workflow while DemoWeave retains ownership of source resolution, output paths, artifact writes, Evidence/Manifest updates, plugin fingerprints, freshness, and selective regeneration.

The milestone is complete only after a real external-style renderer is loaded through `.demoweave/config.json`, produces real derived Evidence, becomes stale when its source/plugin changes, selectively regenerates, and proves no-churn on a second update.

## Non-goals

M14B does not:

- add publisher/upload behavior; M15 owns publishers;
- auto-discover or install plugins;
- sandbox trusted Node.js plugins;
- change Flow v1;
- add plugin-specific selectors/actions;
- let renderers choose arbitrary output paths or mutate Manifest v1 directly;
- silently replace built-in renderers;
- expose raw FFmpeg command/filter strings as a public plugin contract;
- claim `@demoweave/sdk` is published on npm yet.

## Architecture

```text
existing Evidence + artifact bytes
          ↓
    render source resolver
          ↓
 built-in + configured renderer candidates
          ↓ deterministic selection
 plugin renderer transformation
          ↓ bytes + typed result only
 DemoWeave host-owned output writer
          ↓
 derived Evidence + Manifest + fingerprints
          ↓
 freshness / selective update
```

The plugin owns the transformation. DemoWeave owns persistence and provenance.

## Plugin API v1 addition

Extend the existing M14A registry with `registerRenderer()`.

A renderer contribution should have a stable portable ID and explicitly advertise:

- accepted Evidence kinds;
- accepted source Evidence formats;
- output Evidence formats;
- a factory or equivalent clean render lifecycle.

A clean conceptual shape is:

```ts
registry.registerRenderer({
  id: 'fixture-service-card',
  accepts: [
    { kinds: ['result'], formats: ['json'] }
  ],
  outputFormats: ['svg'],
  create({ options }) {
    return {
      async render(input) {
        return {
          kind: 'image',
          format: 'svg',
          mimeType: 'image/svg+xml',
          data: '<svg .../>',
          label: 'Fixture service card'
        };
      }
    };
  }
});
```

Exact naming may differ if implementation constraints demand it, but preserve these semantics.

### Renderer input

The renderer receives a detached/read-only description of the source Evidence, the source artifact bytes, the requested output format, and read-only configured plugin options.

Do not require plugin renderers to open DemoWeave Manifest files or construct project artifact paths themselves.

Do not hand a plugin an output path that it is expected to write directly.

### Renderer result

The renderer returns bytes/text plus typed metadata only.

The host validates at runtime because JavaScript plugins are not protected by TypeScript types. At minimum validate:

- result is an object;
- returned format exactly matches the requested format;
- returned format is an existing `EvidenceFormat v1` value;
- returned kind is an existing `EvidenceKind v1` value;
- MIME type is a non-empty string and matches known format/MIME pairs where DemoWeave already has a canonical mapping;
- data is a string or byte array;
- optional label is a non-empty string.

Malformed renderer results fail before artifact/Manifest mutation.

## Source resolution

Plugin rendering is Evidence-centric.

For a plugin renderer, the source must resolve to an existing Manifest Evidence record with a project-local artifact path. Require source status `available` or `stale`, consistent with current built-in rendering behavior.

Validate the source path remains inside the project root and its artifact exists.

Existing direct TerminalTrack path rendering may remain supported for the built-in terminal renderer. Do not extend arbitrary path inputs to external renderers merely for convenience.

## Renderer selection

Every renderer has a stable runtime ID.

Built-in terminal renderer ID:

```text
terminal
```

Plugin renderer runtime ID:

```text
plugin/<plugin-id>/<renderer-contribution-id>
```

CLI syntax:

```text
demoweave render <evidence-id-or-built-in-path> --format <format>
demoweave render <evidence-id> --format <format> --renderer <renderer-id>
```

Selection rules:

1. Filter candidates by source kind/format and requested output format.
2. If `--renderer` is supplied, require that exact eligible renderer.
3. Without `--renderer`, exactly one eligible renderer may be selected.
4. Zero candidates => clear unsupported-render diagnostic.
5. Multiple candidates => explicit renderer ambiguity error listing stable renderer IDs.
6. A plugin never silently shadows the built-in terminal renderer.

Existing terminal PNG/GIF use should remain unchanged when no plugin creates ambiguity.

`plugins list` / `plugins doctor` must report renderer contribution IDs in addition to detectors/drivers.

## Host-owned derived Evidence

DemoWeave, not the plugin, chooses the artifact destination and writes it atomically.

Default output location follows configured `mediaDir`.

For plugin renderer output, derive a portable deterministic Evidence ID from the source Evidence ID, renderer contribution ID, and format. Contribution IDs are already globally unique in the configured host; avoid machine paths/runtime IDs.

A reasonable shape is:

```text
<source-evidence-id>-<renderer-contribution-id>-<format>
```

The exact deterministic naming algorithm must be documented and tested.

`--out <project-relative-path>` may override the artifact path but must not change producer identity or permit path escape.

The resulting Evidence must include:

- `status: available`;
- returned kind/format/MIME/label;
- safe project-relative artifact path;
- artifact SHA-256;
- `producer.kind: renderer`;
- `producer.id: plugin/<plugin-id>/<renderer-id>`;
- plugin declared version when present;
- `producer.pluginFingerprint` from the M14A host;
- `derivedFrom: [sourceEvidenceId]`;
- provenance that remains portable and preserves material source context without inventing a Flow ID for the renderer.

Do not let the plugin manually append Evidence to Manifest v1.

## Freshness

Extend M14A plugin fingerprint tracking to renderer producer IDs.

Expected behavior:

- same source + same plugin fingerprint + same artifact => fresh;
- source Evidence stale/missing/unknown => derived Evidence propagates the upstream state;
- plugin renderer implementation/options changed => derived Evidence `stale` with `plugin-changed`;
- renderer plugin removed/unavailable => derived Evidence `unknown` with `plugin-unavailable` and no automatic action;
- output artifact bytes changed => normal `artifact-changed` behavior.

## Selective regeneration

Generalize the existing `render-evidence` regeneration action backwards-compatibly.

It should be able to represent plugin renderer work by carrying the renderer ID when needed.

Conceptually:

```json
{
  "kind": "render-evidence",
  "sourceEvidenceId": "plugin-service-result",
  "evidenceId": "plugin-service-result-fixture-service-card-svg",
  "format": "svg",
  "outputPath": "docs-media/plugin-service-result-fixture-service-card-svg.svg",
  "rendererId": "plugin/fixture-service/fixture-service-card"
}
```

Rules:

- existing terminal PNG/GIF actions remain valid without `rendererId`;
- plugin renderer actions include the exact producer renderer ID;
- use existing EvidenceFormat v1 values rather than hard-coding only PNG/GIF in the action schema;
- do not schedule plugin renderer regeneration when the plugin is unavailable/unknown;
- plugin-changed or stale upstream source may schedule the minimum render action;
- `update --apply` invokes the same renderer resolution path as manual `render`;
- second update after a successful repair produces zero actions and no Manifest/artifact churn.

Keep this change backwards-compatible with existing FreshnessReport v1 consumers and synchronize the published schema.

## External-style proof

Extend the existing `fixtures/plugin-sdk` plugin rather than importing its implementation directly into tests.

The fixture already produces `plugin-service-result` as JSON result Evidence. Add a renderer contribution that accepts that real JSON Evidence and produces a deterministic SVG documentation card.

The SVG should be simple, deterministic, readable, dependency-free, and contain only fixture data. Do not use remote assets, fonts, timestamps, randomness, or machine-specific values.

Example command:

```text
demoweave render plugin-service-result \
  --project fixtures/plugin-sdk \
  --format svg \
  --renderer plugin/fixture-service/fixture-service-card
```

Commit one intentional small SVG renderer proof if useful for fixture documentation.

The proof must demonstrate:

1. real configured plugin loading;
2. renderer appears in `plugins list`/`doctor`;
3. source Evidence is resolved from Manifest;
4. SVG artifact is written by DemoWeave, not by the plugin;
5. derived Evidence has renderer producer identity, plugin fingerprint, artifact hash, and `derivedFrom` source;
6. plugin implementation mutation produces `plugin-changed` stale renderer Evidence;
7. source Evidence mutation/upstream stale state propagates;
8. dry-run update schedules only the minimum renderer action where appropriate;
9. update apply repairs the SVG;
10. second update has zero actions and byte-identical Manifest/SVG;
11. disabling/removing the plugin yields `plugin-unavailable` / unknown and zero automatic action;
12. built-in terminal rendering remains unchanged when no renderer ambiguity exists.

## Ambiguity proof

Add a test plugin renderer that deliberately overlaps the built-in terminal PNG or GIF renderer.

Without explicit `--renderer`, rendering that matching source/format must fail with a clear ambiguity diagnostic.

With `--renderer terminal`, the built-in must work.

With the exact plugin renderer ID, the plugin must work if its declared source/output contract matches.

No priority ordering or last-write-wins behavior.

## Path and runtime safety

Test at minimum:

- unsafe `--out` traversal/absolute paths;
- source artifact path escape/missing artifact;
- malformed renderer result;
- returned format mismatch;
- invalid Evidence kind/format;
- MIME mismatch for known formats;
- renderer factory exception;
- renderer execution exception;
- duplicate renderer contribution ID;
- renderer registration after registry closure;
- no absolute plugin paths in persisted Evidence;
- no runtime secrets/IDs persisted by the renderer host path.

Plugins remain trusted Node.js code; these checks enforce the stable API contract, not a security sandbox.

## Cross-platform

Hosted Ubuntu and Windows must exercise the real external-style loader/renderer fixture without needing a browser-specific or native UI environment beyond the existing CI prerequisites.

Pay attention to Windows path normalization, project-root ESM loading, `mediaDir`, atomic replacement, and deterministic SVG bytes/newlines.

## Documentation

When the renderer proof is green:

- update `packages/sdk/README.md` with detector, driver, and renderer examples;
- update root `README.md` with the explicit trusted-plugin model and source-workspace status;
- update `skills/demoweave/SKILL.md` so agents may use already-configured trusted plugins but never auto-enable/install untrusted code;
- update `ROADMAP.md` to mark M14 complete and M15 current only after M14B acceptance passes;
- keep publishers explicitly deferred to M15;
- keep iOS/macOS/Linux platform limitations accurate.

## M14B / M14 completion acceptance

1. `registerRenderer()` exists in plugin API v1 with runtime validation.
2. Renderer contribution identity/duplicates are handled by the existing closed registry.
3. `plugins list`/`doctor` report renderers.
4. Manual `render` resolves built-in/plugin candidates deterministically.
5. Explicit `--renderer` selects an exact renderer.
6. Ambiguous built-in/plugin rendering fails instead of shadowing.
7. External renderer receives source Evidence + bytes and returns bytes/typed metadata only.
8. DemoWeave owns safe output paths and atomic writes.
9. DemoWeave owns derived Evidence/Manifest mutation.
10. Plugin renderer Evidence carries namespaced producer ID + fingerprint + artifact hash + `derivedFrom`.
11. Plugin implementation/options change => `plugin-changed` stale state.
12. Plugin unavailable => unknown / zero automatic action.
13. Stale source propagates to renderer output.
14. `render-evidence` freshness action supports plugin renderer IDs/formats backwards-compatibly.
15. Selective update repairs only the affected renderer output.
16. Second update is zero-action and no-churn.
17. External-style JSON → SVG fixture proof passes on Ubuntu + Windows.
18. Existing terminal render/compositor/tutorial/QA workflows remain green.
19. SDK/root/skill/roadmap documentation is accurate.
20. No publisher runtime, installation, sandbox, or unsupported platform claims are introduced.

Stop before M15 publisher runtime implementation.
