import assert from 'node:assert/strict';
import test from 'node:test';
import { definePlugin, pluginApiVersion } from './index.js';

test('definePlugin is an identity helper for API v1 plugins', () => {
  const plugin = { id: 'fixture', apiVersion: pluginApiVersion, register() {} };
  assert.equal(definePlugin(plugin), plugin);
  assert.equal(pluginApiVersion, 1);
});
