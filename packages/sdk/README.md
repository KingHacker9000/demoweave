# `@demoweave/sdk`

This workspace-only package is the public authoring boundary for DemoWeave plugins. It is not published to npm at this checkpoint.

Plugins register stable detector, driver, and renderer contributions through API v1:

```js
import { definePlugin, pluginApiVersion } from '@demoweave/sdk';

export default definePlugin({
  id: 'example',
  apiVersion: pluginApiVersion,
  version: '0.0.1',
  register(registry) {
    registry.registerDetector({ /* stable detector contribution */ });
    registry.registerDriver({ /* per-Flow driver factory */ });
    registry.registerRenderer({
      id: 'result-card',
      accepts: [{ kinds: ['result'], formats: ['json'] }],
      outputFormats: ['svg'],
      create({ options }) {
        return {
          render({ source, sourceBytes, format }) {
            return {
              kind: 'image',
              format,
              mimeType: 'image/svg+xml',
              data: '<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n',
              label: `${source.label ?? source.id} card`,
            };
          },
          close() {},
        };
      },
    });
  },
});
```

Renderer descriptors explicitly declare accepted Evidence kind/format pairs and output formats. Each factory receives recursively read-only configured options. Its renderer receives detached, recursively read-only source Evidence, a detached byte array, and the exact requested format. It returns only typed bytes/text plus `kind`, `format`, `mimeType`, and an optional label; it never chooses an output path or edits Manifest v1. DemoWeave validates plain JavaScript results before mutation, writes the artifact atomically under the configured `mediaDir` (or a safe `--out` override), and records deterministic derived Evidence with producer identity, plugin fingerprint, artifact hash, and `derivedFrom`.

Enable a plugin only through the target repository's ordered `.demoweave/config.json` `plugins` list. DemoWeave does not discover or install plugins. Plugins are trusted Node.js code with the same process privileges as the CLI; they are not sandboxed. Runtime renderer IDs are `plugin/<plugin-id>/<renderer-id>`; the built-in terminal renderer is `terminal`. Exact `--renderer` selection must be eligible, and an unqualified render fails explicitly when multiple renderers match.

Plugin drivers should use the factory-provided Evidence service for artifacts. The host owns safe destinations, Evidence validation, Manifest normalization, atomic writes, hashing, producer identity, and Flow/source fingerprint completion.
