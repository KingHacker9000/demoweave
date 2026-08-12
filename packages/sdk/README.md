# `@demoweave/sdk`

This workspace-only package is the public authoring boundary for DemoWeave plugins. It is not published to npm at this checkpoint.

```js
import { definePlugin, pluginApiVersion } from '@demoweave/sdk';

export default definePlugin({
  id: 'example',
  apiVersion: pluginApiVersion,
  version: '0.0.1',
  register(registry) {
    registry.registerDetector({ /* stable detector contribution */ });
    registry.registerDriver({ /* per-Flow driver factory */ });
  },
});
```

Enable a plugin only through the target repository's ordered `.demoweave/config.json` `plugins` list. DemoWeave does not discover or install plugins. Plugins are trusted Node.js code with the same process privileges as the CLI; they are not sandboxed.

Plugin drivers should use the factory-provided Evidence service for artifacts. The host owns safe destinations, Evidence validation, Manifest normalization, atomic writes, hashing, producer identity, and Flow/source fingerprint completion.
