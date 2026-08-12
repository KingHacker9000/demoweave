# M14 — Plugin / driver SDK

Status: current design contract for `feat/m14-plugin-sdk`.

M14 turns DemoWeave's internal extension boundaries into an explicit, versioned plugin host without changing the core product rule: agents provide judgment; DemoWeave provides deterministic tooling.

## Goal

A repository should be able to explicitly enable trusted third-party DemoWeave plugins that contribute new project detection and runtime behavior without forking the CLI or importing DemoWeave's private implementation files.

The first proof must be a real external-style plugin package loaded through the same path a future third-party package would use.

## Non-goals

M14 does **not**:

- auto-install packages;
- scan `node_modules` for plugins;
- execute arbitrary repository dependencies merely because they look like plugins;
- sandbox untrusted JavaScript;
- add hidden LLM calls;
- invent new Flow actions or platform-specific selectors;
- make publisher/upload behavior part of M14 (M15 owns publishers);
- claim npm publication before packages are actually published;
- make iOS/macOS/Linux runtime claims that have not been proven on those hosts.

Plugin modules are trusted executable Node.js code and have the same process privileges as DemoWeave. Enabling a plugin is an explicit trust decision.

## Architecture

```text
.demoweave/config.json
        ↓ explicit plugin modules only
Plugin Loader
        ↓
Plugin Host / Registry (API v1)
        ├─ project detectors
        ├─ surface-driver factories
        ├─ renderer contributions
        └─ future publisher contributions (M15 execution)
        ↓
existing DemoWeave orchestration
        ├─ analyzeProject
        ├─ run / update
        ├─ Evidence + Manifest + freshness
        └─ render
```

The host owns loading, validation, duplicate detection, lifecycle, diagnostics, and stable services. Plugins should not reach into `packages/cli/src/*`, private analyzer internals, or internal manifest-writing helpers.

## Package boundary

Add a small workspace package named `@demoweave/sdk` for the public plugin-facing API.

For this source checkpoint it may remain workspace-only; documentation must not pretend it is already published on npm. Its exports should be intentionally small and versioned.

A plugin should be able to write:

```ts
import { definePlugin, pluginApiVersion } from '@demoweave/sdk';

export default definePlugin({
  id: 'example',
  apiVersion: pluginApiVersion,
  version: '0.0.1',
  register(registry) {
    registry.registerDetector(...);
    registry.registerDriver(...);
  },
});
```

Do not require plugin authors to import `@demoweave/cli` or private source paths.

## Explicit configuration

Extend `.demoweave/config.json` backwards-compatibly with an optional ordered plugin list. Conceptually:

```json
{
  "schemaVersion": 1,
  "mediaDir": "docs-media",
  "plugins": [
    {
      "module": "./plugins/example-plugin/dist/index.js",
      "options": {}
    }
  ]
}
```

Also support package module specifiers when they can be resolved from the project root.

Rules:

- no automatic plugin discovery;
- no network install;
- project-relative module paths must remain inside the project root after realpath/symlink resolution;
- package specifiers resolve from the target project's dependency context, not DemoWeave's own working directory;
- absolute filesystem module paths are rejected by default;
- plugin order is deterministic and follows config order;
- duplicate plugin IDs fail explicitly;
- unsupported API versions fail before plugin contributions are used;
- missing/default-export-invalid modules fail with stable diagnostics;
- plugin `options` must be JSON-compatible data;
- secrets/runtime identifiers should use invocation environment/runtime options rather than committed config.

## Plugin API v1

The exported plugin object must contain at least:

- `id` — portable stable identifier;
- `apiVersion: 1`;
- optional semantic `version`;
- `register(registry)` lifecycle hook.

`definePlugin()` is a type-safe identity helper; it must not hide runtime behavior.

Registration is declarative. A plugin cannot mutate the global registry after registration has finished.

Contribution IDs must be stable and unique within the resolved host. Duplicate contribution IDs fail instead of silently shadowing another plugin or built-in.

## Project detector contribution

The first detector contract should be deliberately narrower than arbitrary ProjectProfile mutation.

A detector receives a read-only project context and may return additive, schema-valid detection facts that DemoWeave can deterministically merge. M14A should at minimum support plugin-provided:

- `Surface` entries using existing `SurfaceType v1` values;
- framework facts where useful.

The host must:

- normalize project-relative roots;
- reject traversal and symlink escapes;
- validate every returned contribution with existing core schemas;
- reject duplicate/conflicting surface IDs rather than relying on last-write-wins;
- preserve deterministic ordering;
- keep existing built-in analyzer behavior unchanged when no plugins are configured.

Do not open `ProjectProfile v1` to arbitrary unknown ecosystems/types merely to make a fixture work.

## Driver contribution

Plugin drivers should use a factory rather than a process-global singleton so every Flow execution receives a clean lifecycle.

The stable behavior is still the existing semantic driver lifecycle:

```text
supports(surface)
prepare(context)
execute(step, context)
close(context)
```

Flow v1 remains unchanged. A plugin driver advertises the existing surface types and Flow step types it supports. Platform-specific selectors, coordinates, commands, device IDs, or plugin-private automation syntax do not enter Flow v1.

Built-in drivers and plugin drivers share deterministic selection rules. A configured plugin must not silently override a built-in driver. If two eligible drivers would make selection ambiguous, fail with an explicit diagnostic unless the selection policy is explicitly defined and tested.

## Host-owned Evidence service

External drivers/renderers must not each reimplement DemoWeave manifest writes, path validation, artifact hashing, or provenance normalization.

M14 should expose a narrow host service for writing plugin-produced artifacts/Evidence. The service owns:

- project-local artifact destination;
- evidence ID/path validation;
- safe atomic writes;
- format/MIME validation where known;
- `EvidenceSchema` validation;
- normalized Manifest update;
- producer identity namespaced to the plugin/contribution;
- artifact hashing;
- Flow/source fingerprint completion through the existing provenance path;
- no runtime secret/device identifier persistence.

The API should make the safe path easier than manual Manifest mutation.

A plugin may still return ordinary non-Evidence step results without using this service.

## Plugin identity and freshness

Evidence produced by a plugin must identify the plugin contribution in producer metadata.

M14 must also define a deterministic plugin identity fingerprint used by the host when plugin behavior materially determines an artifact. At minimum it should bind the resolved plugin entry bytes and declared plugin identity/version; local plugin options that materially affect output must also be bound or represented as explicit source/runtime inputs.

Do not rely on a human-maintained version string alone for freshness.

The fingerprint must not serialize secrets into Evidence or Manifest.

A changed plugin implementation should make dependent plugin-produced Evidence explainably stale or otherwise refuse to claim it is fresh.

## Renderer contributions

M14 should establish a registry contract for renderer contributions and then prove one external-style renderer before the milestone is complete.

A renderer advertises what Evidence kinds/formats it accepts and what output formats it can produce. DemoWeave owns output path safety, derived Evidence/Manifest updates, hashing, and provenance; the plugin owns the transformation.

Do not let a plugin renderer silently replace a built-in renderer. Ambiguity is an error unless an explicit renderer ID is selected.

Renderer integration may be implemented after the M14A loader/detector/driver proof, but it remains part of M14.

## Publishers

The registry may reserve/version the publisher contribution shape if doing so is clean, but M14 must not invent an unused upload API merely to satisfy a checklist. M15 owns actual documentation publishing integrations and is where the publisher runtime contract should be proven against real targets.

## CLI

Add a small inspectable plugin surface rather than hiding loaded code.

Minimum commands/behavior:

```text
demoweave plugins list [--project <path>] [--json]
demoweave plugins doctor [--project <path>] [--json]
```

`plugins list` reports configured/resolved plugins and registered contribution IDs without executing repository workflows.

`plugins doctor` loads/validates the plugin host and reports resolution/API/registration diagnostics. It must not run Flows, publish, or mutate Evidence.

Normal commands such as `inspect`, `run`, and `update --apply` load the configured host only when the command needs the corresponding contributions.

When no plugins are configured, existing CLI output/behavior should remain stable except for intentionally documented `doctor` additions.

## Example external-style fixture

Create a plugin fixture that is structurally separate from the host implementation and loaded only through `.demoweave/config.json`.

The fixture should prove:

1. an external detector contributes a stable existing-type surface from a marker/config file;
2. an external driver factory handles a semantic Flow against that detected surface;
3. the driver produces at least one real Evidence artifact through the host-owned Evidence service;
4. the Evidence has plugin producer identity, artifact hash, Flow hash, and declared source hashes;
5. plugin implementation mutation invalidates freshness in a controlled test;
6. source mutation yields the normal stale reason;
7. selective `update --apply` reruns only the affected Flow where supported;
8. a second update performs zero actions and no artifact/Manifest churn;
9. removing or disabling the plugin produces an explicit unresolved/driver diagnostic instead of silently changing meaning.

The fixture must not be imported directly by tests as if it were first-party code. Exercise the real loader.

## Security and path rules

Test at least:

- `../` module traversal;
- absolute path rejection;
- local plugin symlink escaping project root;
- package resolution anchored at project root;
- missing module;
- invalid module export;
- duplicate plugin IDs;
- duplicate contribution IDs;
- unsupported API version;
- plugin registration exception;
- malformed options;
- artifact path/evidence ID escape attempts;
- no secrets/runtime IDs persisted by the host.

Document clearly that Node plugins are trusted code, not a security sandbox.

## Determinism

Given the same project files, plugin config, resolved plugin bytes, and plugin inputs, registry resolution and produced metadata must be stable.

Do not persist absolute plugin installation paths in ProjectProfile, Evidence, Manifest, or committed fixture metadata.

Diagnostics may mention a path locally when needed to fix configuration, but portable persisted artifacts must not.

## M14A exit criteria — loader + detector + driver

- `@demoweave/sdk` exists with `pluginApiVersion = 1` and `definePlugin`;
- config schema/read path supports explicit plugins backwards-compatibly;
- safe project-root-anchored ESM loading works on Windows and Linux;
- plugin IDs/API versions/contributions validate deterministically;
- `plugins list` and `plugins doctor` exist;
- plugin detector contributes schema-valid surface/framework facts;
- plugin driver factory participates in Flow execution without Flow v1 changes;
- host-owned Evidence writing is used by the fixture driver;
- plugin producer/fingerprint is represented in freshness semantics;
- real loader fixture passes source/plugin mutation + selective repair + no-churn tests;
- no-plugin projects preserve existing behavior;
- build/test/typecheck and normal milestone smokes remain green on hosted Ubuntu + Windows.

## M14 completion criteria

In addition to M14A:

- renderer registration/resolution is implemented and one external-style renderer is proven;
- SDK docs show how to author/test a plugin without importing private implementation paths;
- shared DemoWeave skill explains when to use configured plugins and never auto-enable untrusted ones;
- README/ROADMAP accurately describe source-workspace vs published-package status;
- no unsupported publisher/install/sandbox claims are introduced.

## Review rule

Do not merge M14 merely because unit tests pass. Review the loader trust/path model, cross-platform module resolution, plugin fingerprint/freshness behavior, fixture Evidence/provenance, no-plugin compatibility, and the actual external-style fixture output before marking the milestone complete.
