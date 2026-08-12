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
  MobileBackend,
  MobileBackendDescriptor,
  MobileBackendStep,
  MobileBackendStepResult,
  MobileRuntimeTarget,
} from './mobile-backend.js';
import { MobileDriver } from './mobile-driver.js';
import { executeFlow } from './executor.js';
import type { DriverContext } from './index.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4sVAAAAAASUVORK5CYII=',
  'base64',
);

class FakeMobileBackend implements MobileBackend {
  readonly descriptor: MobileBackendDescriptor = {
    id: 'fake-android',
    apiVersion: 1,
    version: 'test',
    platforms: ['android'],
    stepTypes: ['activate', 'input', 'press', 'scroll', 'wait', 'assert', 'capture'],
    capabilities: [
      'semantic-control',
      'text-input',
      'keyboard-input',
      'scroll',
      'screen-capture',
      'element-capture',
    ],
  };

  readonly steps: MobileBackendStep[] = [];
  readonly targets: MobileRuntimeTarget[] = [];
  opened = 0;
  closed = 0;
  available = true;
  captureBytes: Uint8Array = ONE_PIXEL_PNG;

  async probe(_context: DriverContext, target: MobileRuntimeTarget) {
    this.targets.push(target);
    return this.available ? { available: true } : { available: false, reason: 'fixture backend disabled' };
  }

  async open(_context: DriverContext, target: MobileRuntimeTarget): Promise<void> {
    this.opened += 1;
    this.targets.push(target);
  }

  async execute(step: MobileBackendStep, _context: DriverContext, target: MobileRuntimeTarget): Promise<MobileBackendStepResult> {
    this.steps.push(step);
    this.targets.push(target);
    if (step.type === 'capture') {
      return { status: 'passed', capture: { format: 'png', bytes: this.captureBytes, width: 1, height: 1 } };
    }
    return { status: 'passed' };
  }

  async close(_context: DriverContext, target: MobileRuntimeTarget): Promise<void> {
    this.closed += 1;
    this.targets.push(target);
  }
}

async function makeProject(t: test.TestContext): Promise<{ root: string; flow: Flow; flowPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-mobile-driver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'flows'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.ts'), 'export const mobileFixture = true;\n');

  const flow = FlowSchema.parse({
    schemaVersion: 1,
    id: 'mobile-proof',
    surfaceId: 'mobile-app',
    sources: [{ path: 'src/app.ts', role: 'implementation' }],
    steps: [
      { id: 'activate-create', type: 'activate', target: { strategy: 'automationId', value: 'create-button' } },
      { id: 'input-name', type: 'input', target: { strategy: 'automationId', value: 'project-name' }, value: 'Demo Project', clear: true },
      { id: 'press-enter', type: 'press', key: 'Enter' },
      { id: 'scroll-results', type: 'scroll', direction: 'down', amount: 120 },
      { id: 'wait-result', type: 'wait', condition: { kind: 'visible', target: { strategy: 'automationId', value: 'result-panel' } } },
      { id: 'assert-result', type: 'assert', assertion: { kind: 'visible', target: { strategy: 'automationId', value: 'result-panel' } } },
      { id: 'capture-screen', type: 'capture', evidenceId: 'mobile-result', kind: 'screenshot', label: 'Mobile fixture result' },
    ],
  });
  const flowPath = path.join(root, '.demoweave', 'flows', 'mobile-proof.json');
  await fs.writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: flow.id, path: '.demoweave/flows/mobile-proof.json', surfaceId: flow.surfaceId }],
    evidence: [{
      schemaVersion: 1,
      id: 'mobile-result',
      kind: 'screenshot',
      status: 'planned',
      label: 'Mobile fixture result',
      provenance: { flowId: flow.id, stepId: 'capture-screen', surfaceId: flow.surfaceId, sources: [] },
    }],
  }, null, 2)}\n`);
  return { root, flow, flowPath };
}

function projectProfile() {
  return ProjectProfileSchema.parse({
    schemaVersion: 1,
    name: 'mobile-fixture',
    root: '.',
    analyzedAt: new Date(0).toISOString(),
    packageManagers: [],
    workspaces: [],
    components: [],
    languages: [],
    frameworks: [],
    surfaces: [{ id: 'mobile-app', type: 'mobile', root: '.', label: 'Mobile fixture' }],
    commands: { install: [], build: [], test: [], run: [] },
    existingDocs: [],
  });
}

test('runs semantic mobile steps through a matching backend and snapshots screenshot Evidence', async (t) => {
  const { root, flow, flowPath } = await makeProject(t);
  const backend = new FakeMobileBackend();
  const driver = new MobileDriver({ backends: [backend], platform: 'android', deviceId: 'emulator-5554' });
  const result = await executeFlow(root, projectProfile(), flow, flowPath, { drivers: [driver] });

  assert.equal(result.status, 'passed');
  assert.equal(result.driverId, 'mobile');
  assert.equal(backend.opened, 1);
  assert.equal(backend.closed, 1);
  assert.deepEqual(backend.steps.map((step) => step.type), ['activate', 'input', 'press', 'scroll', 'wait', 'assert', 'capture']);
  assert.ok(backend.targets.every((target) => target.platform === 'android' && target.deviceId === 'emulator-5554'));

  const evidence = result.evidence[0]!;
  assert.equal(evidence.id, 'mobile-result');
  assert.equal(evidence.kind, 'screenshot');
  assert.equal(evidence.format, 'png');
  assert.equal(evidence.producer?.id, 'mobile/fake-android');
  assert.match(evidence.artifactHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence.provenance.flowHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.equal(evidence.provenance.sources[0]?.path, 'src/app.ts');
  assert.deepEqual(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'mobile-result.png')), ONE_PIXEL_PNG);

  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8')));
  assert.equal(manifest.evidence.find((item) => item.id === 'mobile-result')?.producer?.id, 'mobile/fake-android');
});

test('requires an explicit runtime mobile platform', async (t) => {
  const { root, flow, flowPath } = await makeProject(t);
  const result = await executeFlow(root, projectProfile(), flow, flowPath, { drivers: [new MobileDriver({ backends: [new FakeMobileBackend()] })] });
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'PREPARE_FAILED');
  assert.match(result.error?.message ?? '', /--mobile-platform android\|ios/);
});

test('fails explicitly when a platform has no registered backend', async (t) => {
  const { root, flow, flowPath } = await makeProject(t);
  const result = await executeFlow(root, projectProfile(), flow, flowPath, { drivers: [new MobileDriver({ backends: [], platform: 'ios', deviceId: 'simulator-id' })] });
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'PREPARE_FAILED');
  assert.match(result.error?.message ?? '', /No mobile backend is registered for ios/);
});

test('surfaces backend probe diagnostics and rejects invalid PNG bytes', async (t) => {
  const { root, flow } = await makeProject(t);
  const backend = new FakeMobileBackend();
  backend.available = false;
  const driver = new MobileDriver({ backends: [backend], platform: 'android', deviceId: 'device-1' });
  const context: DriverContext = { projectRoot: root, surface: projectProfile().surfaces[0]!, flow };
  await assert.rejects(driver.prepare(context), /fake-android: fixture backend disabled/);

  backend.available = true;
  backend.captureBytes = Buffer.from('not-a-png');
  await driver.prepare(context);
  const capture = flow.steps.find((step) => step.type === 'capture')!;
  const result = await driver.execute(capture, context);
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'MOBILE_BACKEND_ERROR');
  assert.match(result.error?.message ?? '', /not a valid PNG/);
  await driver.close(context);
});
