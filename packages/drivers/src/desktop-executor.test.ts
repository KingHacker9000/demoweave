import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FlowSchema, ProjectProfileSchema } from '@demoweave/core';
import { executeFlow } from './executor.js';

test('default executor routes desktop surfaces to DesktopDriver and requires a real native backend', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-desktop-executor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'flows'), { recursive: true });

  const flow = FlowSchema.parse({
    schemaVersion: 1,
    id: 'desktop-default-route',
    surfaceId: 'desktop-app',
    steps: [{ id: 'press-enter', type: 'press', key: 'Enter' }],
  });
  const flowPath = path.join(root, '.demoweave', 'flows', 'desktop-default-route.json');
  await fs.writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`);

  const project = ProjectProfileSchema.parse({
    schemaVersion: 1,
    name: 'desktop-default-route',
    root: '.',
    analyzedAt: new Date(0).toISOString(),
    packageManagers: [],
    workspaces: [],
    components: [],
    languages: [],
    frameworks: [],
    surfaces: [{ id: 'desktop-app', type: 'desktop', root: '.' }],
    commands: { install: [], build: [], test: [], run: [] },
    existingDocs: [],
  });

  const result = await executeFlow(root, project, flow, flowPath);
  assert.equal(result.status, 'failed');
  assert.equal(result.driverId, 'desktop');
  assert.equal(result.error?.code, 'PREPARE_FAILED');
  assert.match(result.error?.message ?? '', /No desktop backend is registered for/);
  assert.deepEqual(result.steps, [{ stepId: 'press-enter', status: 'skipped' }]);
  assert.deepEqual(result.evidence, []);
});
