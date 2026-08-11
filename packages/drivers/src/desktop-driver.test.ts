import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FlowSchema,
  ManifestSchema,
  ProjectProfileSchema,
  type Flow,
} from '@demoweave/core';
import type {
  DesktopBackend,
  DesktopBackendDescriptor,
  DesktopBackendStep,
  DesktopBackendStepResult,
} from './desktop-backend.js';
import type { DesktopHostCapabilities } from './desktop-capabilities.js';
import { DesktopDriver } from './desktop-driver.js';
import { executeFlow } from './executor.js';
import type { DriverContext } from './index.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4sVAAAAAASUVORK5CYII=',
  'base64',
);

const WINDOWS_HOST: DesktopHostCapabilities = {
  platform: 'windows',
  sessionKind: 'windows-session',
  interactiveSession: 'present',
  detail: 'test host',
};

class FakeDesktopBackend implements DesktopBackend {
  readonly descriptor: DesktopBackendDescriptor = {
    id: 'fake-uia',
    apiVersion: 1,
    version: 'test',
    platforms: ['windows'],
    stepTypes: ['activate', 'input', 'press', 'scroll', 'wait', 'assert', 'capture'],
    capabilities: [
      'semantic-control',
      'text-input',
      'keyboard-input',
      'scroll',
      'window-capture',
      'element-capture',
    ],
  };

  readonly steps: DesktopBackendStep[] = [];
  opened = 0;
  closed = 0;
  available = true;
  captureBytes: Uint8Array = ONE_PIXEL_PNG;

  async probe(): Promise<{ available: boolean; reason?: string }> {
    return this.available ? { available: true } : { available: false, reason: 'fixture backend disabled' };
  }

  async open(): Promise<void> {
    this.opened += 1;
  }

  async execute(step: DesktopBackendStep): Promise<DesktopBackendStepResult> {
    this.steps.push(step);
    if (step.type === 'capture') {
      return { status: 'passed', capture: { format: 'png', bytes: this.captureBytes, width: 1, height: 1 } };
    }
    return { status: 'passed' };
  }

  async close(): Promise<void> {
    this.closed += 1;
  }
}

async function makeProject(t: test.TestContext): Promise<{
  root: string;
  flow: Flow;
  flowPath: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-desktop-driver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'flows'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.ts'), 'export const desktopFixture = true;\n');

  const flow = FlowSchema.parse({
    schemaVersion: 1,
    id: 'desktop-proof',
    surfaceId: 'desktop-app',
    sources: [{ path: 'src/app.ts', role: 'implementation' }],
    steps: [
      {
        id: 'activate-create',
        type: 'activate',
        target: { strategy: 'automationId', value: 'create-button' },
      },
      {
        id: 'input-name',
        type: 'input',
        target: { strategy: 'automationId', value: 'project-name' },
        value: 'Demo Project',
        clear: true,
      },
      { id: 'press-enter', type: 'press', key: 'Enter' },
      { id: 'scroll-results', type: 'scroll', direction: 'down', amount: 240 },
      {
        id: 'wait-result',
        type: 'wait',
        condition: {
          kind: 'visible',
          target: { strategy: 'automationId', value: 'result-panel' },
        },
      },
      {
        id: 'assert-result',
        type: 'assert',
        assertion: {
          kind: 'visible',
          target: { strategy: 'automationId', value: 'result-panel' },
        },
      },
      {
        id: 'capture-window',
        type: 'capture',
        evidenceId: 'desktop-result',
        kind: 'screenshot',
        label: 'Desktop fixture result',
      },
    ],
  });
  const flowPath = path.join(root, '.demoweave', 'flows', 'desktop-proof.json');
  await fs.writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: flow.id, path: '.demoweave/flows/desktop-proof.json', surfaceId: flow.surfaceId }],
    evidence: [{
      schemaVersion: 1,
      id: 'desktop-result',
      kind: 'screenshot',
      status: 'planned',
      label: 'Desktop fixture result',
      provenance: {
        flowId: flow.id,
        stepId: 'capture-window',
        surfaceId: flow.surfaceId,
        sources: [],
      },
    }],
  }, null, 2)}\n`);
  return { root, flow, flowPath };
}

function projectProfile() {
  return ProjectProfileSchema.parse({
    schemaVersion: 1,
    name: 'desktop-fixture',
    root: '.',
    analyzedAt: new Date(0).toISOString(),
    packageManagers: [],
    workspaces: [],
    components: [],
    languages: [],
    frameworks: [],
    surfaces: [{ id: 'desktop-app', type: 'desktop', root: '.', label: 'Desktop fixture' }],
    commands: { install: [], build: [], test: [], run: [] },
    existingDocs: [],
  });
}

test('runs semantic desktop steps through an available backend and snapshots screenshot Evidence', async (t) => {
  const { root, flow, flowPath } = await makeProject(t);
  const backend = new FakeDesktopBackend();
  const driver = new DesktopDriver({ backends: [backend], hostCapabilities: WINDOWS_HOST });
  const result = await executeFlow(root, projectProfile(), flow, flowPath, { drivers: [driver] });

  assert.equal(result.status, 'passed');
  assert.equal(result.driverId, 'desktop');
  assert.equal(backend.opened, 1);
  assert.equal(backend.closed, 1);
  assert.deepEqual(backend.steps.map((step) => step.type), [
    'activate', 'input', 'press', 'scroll', 'wait', 'assert', 'capture',
  ]);
  assert.deepEqual(
    (backend.steps[0] as Extract<DesktopBackendStep, { type: 'activate' }>).target,
    { strategy: 'automationId', value: 'create-button' },
  );

  const evidence = result.evidence[0]!;
  assert.equal(evidence.id, 'desktop-result');
  assert.equal(evidence.kind, 'screenshot');
  assert.equal(evidence.format, 'png');
  assert.equal(evidence.producer?.id, 'desktop/fake-uia');
  assert.match(evidence.artifactHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence.provenance.flowHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.equal(evidence.provenance.sources[0]?.path, 'src/app.ts');
  assert.match(evidence.provenance.sources[0]?.hash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    await fs.readFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'desktop-result.png')),
    ONE_PIXEL_PNG,
  );

  const manifest = ManifestSchema.parse(JSON.parse(
    await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8'),
  ));
  assert.equal(manifest.evidence.find((item) => item.id === 'desktop-result')?.producer?.id, 'desktop/fake-uia');
});

test('fails explicitly when a desktop surface has no native backend instead of pretending support', async (t) => {
  const { root, flow, flowPath } = await makeProject(t);
  const driver = new DesktopDriver({ backends: [], hostCapabilities: WINDOWS_HOST });
  const result = await executeFlow(root, projectProfile(), flow, flowPath, { drivers: [driver] });
  assert.equal(result.status, 'failed');
  assert.equal(result.driverId, 'desktop');
  assert.equal(result.error?.code, 'PREPARE_FAILED');
  assert.match(result.error?.message ?? '', /No desktop backend is registered for windows/);
  assert.ok(result.steps.every((step) => step.status === 'skipped'));
});

test('surfaces backend probe diagnostics when registered native automation is unavailable', async (t) => {
  const { root, flow } = await makeProject(t);
  const backend = new FakeDesktopBackend();
  backend.available = false;
  const driver = new DesktopDriver({ backends: [backend], hostCapabilities: WINDOWS_HOST });
  const context: DriverContext = {
    projectRoot: root,
    surface: projectProfile().surfaces[0]!,
    flow,
  };
  await assert.rejects(
    driver.prepare(context),
    /fake-uia: fixture backend disabled/,
  );
});

test('rejects invalid backend image bytes before they can become screenshot Evidence', async (t) => {
  const { root, flow } = await makeProject(t);
  const backend = new FakeDesktopBackend();
  backend.captureBytes = Buffer.from('not-a-png');
  const driver = new DesktopDriver({ backends: [backend], hostCapabilities: WINDOWS_HOST });
  const context: DriverContext = {
    projectRoot: root,
    surface: projectProfile().surfaces[0]!,
    flow,
  };
  await driver.prepare(context);
  const captureStep = flow.steps.find((step) => step.type === 'capture')!;
  const result = await driver.execute(captureStep, context);
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'DESKTOP_BACKEND_ERROR');
  assert.match(result.error?.message ?? '', /not a valid PNG/);
  await driver.close(context);
});
