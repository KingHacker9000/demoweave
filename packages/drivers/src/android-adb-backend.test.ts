import assert from 'node:assert/strict';
import test from 'node:test';
import { FlowSchema, ProjectProfileSchema } from '@demoweave/core';
import {
  AndroidAdbBackend,
  androidNodeMatchesTarget,
  parseAndroidUiHierarchy,
  type AdbCommandResult,
  type AdbRunner,
} from './android-adb-backend.js';
import type { DriverContext } from './index.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4sVAAAAAASUVORK5CYII=',
  'base64',
);

const HIERARCHY = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="com.demoweave.fixture:id/root" class="android.widget.LinearLayout" package="com.demoweave.fixture" content-desc="" clickable="false" enabled="true" focused="false" scrollable="false" bounds="[0,0][1080,1920]">
    <node index="0" text="" resource-id="com.demoweave.fixture:id/project_name" class="android.widget.EditText" package="com.demoweave.fixture" content-desc="Project name" clickable="true" enabled="true" focused="false" scrollable="false" bounds="[80,300][1000,430]" />
    <node index="1" text="Create" resource-id="com.demoweave.fixture:id/create_button" class="android.widget.Button" package="com.demoweave.fixture" content-desc="Create project" clickable="true" enabled="true" focused="false" scrollable="false" bounds="[80,480][1000,610]" />
    <node index="2" text="Demo Project created" resource-id="com.demoweave.fixture:id/result" class="android.widget.TextView" package="com.demoweave.fixture" content-desc="Project result" clickable="false" enabled="true" focused="false" scrollable="false" bounds="[80,680][1000,780]" />
  </node>
</hierarchy>`;

function result(stdout = '', exitCode: number | null = 0, stderr = ''): AdbCommandResult {
  return { exitCode, stdout: Buffer.from(stdout), stderr };
}

class FakeAdbRunner implements AdbRunner {
  readonly calls: string[][] = [];
  devices = 'List of devices attached\nemulator-5554\tdevice\n';
  hierarchy = HIERARCHY;
  capture = ONE_PIXEL_PNG;

  async run(args: string[]): Promise<AdbCommandResult> {
    this.calls.push(args);
    const joined = args.join(' ');
    if (joined === 'version') return result('Android Debug Bridge version 1.0.41\n');
    if (joined === 'devices') return result(this.devices);
    if (joined.includes('uiautomator dump')) return result('UI hierchary dumped to file\n');
    if (joined.includes('exec-out cat')) return { exitCode: 0, stdout: Buffer.from(this.hierarchy), stderr: '' };
    if (joined.includes('exec-out screencap -p')) return { exitCode: 0, stdout: this.capture, stderr: '' };
    if (joined.includes('shell wm size')) return result('Physical size: 1080x1920\n');
    return result();
  }
}

function context(): DriverContext {
  const flow = FlowSchema.parse({
    schemaVersion: 1,
    id: 'android-proof',
    surfaceId: 'mobile-app',
    steps: [{ id: 'capture', type: 'capture', evidenceId: 'screen', kind: 'screenshot' }],
  });
  const profile = ProjectProfileSchema.parse({
    schemaVersion: 1,
    name: 'android-fixture',
    root: '.',
    analyzedAt: new Date(0).toISOString(),
    packageManagers: [],
    workspaces: [],
    components: [],
    languages: [],
    frameworks: [],
    surfaces: [{ id: 'mobile-app', type: 'mobile', root: '.' }],
    commands: { install: [], build: [], test: [], run: [] },
    existingDocs: [],
  });
  return { projectRoot: '.', surface: profile.surfaces[0]!, flow };
}

test('parses UIAutomator hierarchy and maps portable semantic targets', () => {
  const nodes = parseAndroidUiHierarchy(HIERARCHY);
  assert.equal(nodes.length, 4);
  const input = nodes.find((node) => node.resourceId.endsWith('/project_name'))!;
  const button = nodes.find((node) => node.resourceId.endsWith('/create_button'))!;
  const resultNode = nodes.find((node) => node.resourceId.endsWith('/result'))!;

  assert.equal(androidNodeMatchesTarget(input, { strategy: 'automationId', value: 'project_name' }), true);
  assert.equal(androidNodeMatchesTarget(input, { strategy: 'accessibilityId', value: 'Project name' }), true);
  assert.equal(androidNodeMatchesTarget(button, { strategy: 'role', value: 'button' }), true);
  assert.equal(androidNodeMatchesTarget(button, { strategy: 'text', value: 'Create' }), true);
  assert.equal(androidNodeMatchesTarget(resultNode, { strategy: 'name', value: 'Project result' }), true);
  assert.equal(androidNodeMatchesTarget(resultNode, { strategy: 'text', value: 'Project', exact: false }), true);
});

test('selects the only ready Android device or requires an explicit id when ambiguous', async () => {
  const runner = new FakeAdbRunner();
  const backend = new AndroidAdbBackend({ runner });
  assert.deepEqual(await backend.probe(context(), { platform: 'android' }), {
    available: true,
    detail: 'Using the only ready Android device: emulator-5554',
  });

  const ambiguous = new FakeAdbRunner();
  ambiguous.devices = 'List of devices attached\nemulator-5554\tdevice\nR58M123\tdevice\n';
  const ambiguousBackend = new AndroidAdbBackend({ runner: ambiguous });
  const probe = await ambiguousBackend.probe(context(), { platform: 'android' });
  assert.equal(probe.available, false);
  assert.equal(probe.reason, 'MOBILE_DEVICE_ID_REQUIRED');

  const explicit = await ambiguousBackend.probe(context(), { platform: 'android', deviceId: 'R58M123' });
  assert.equal(explicit.available, true);
});

test('reports missing/offline devices and unavailable adb explicitly', async () => {
  const missing = new FakeAdbRunner();
  missing.devices = 'List of devices attached\n';
  assert.equal((await new AndroidAdbBackend({ runner: missing }).probe(context(), { platform: 'android' })).reason, 'MOBILE_DEVICE_NOT_FOUND');

  const offline = new FakeAdbRunner();
  offline.devices = 'List of devices attached\nemulator-5554\toffline\n';
  assert.equal((await new AndroidAdbBackend({ runner: offline }).probe(context(), { platform: 'android', deviceId: 'emulator-5554' })).reason, 'MOBILE_DEVICE_UNAVAILABLE');

  const unavailable: AdbRunner = { run: async () => ({ exitCode: null, stdout: Buffer.alloc(0), stderr: 'spawn adb ENOENT' }) };
  assert.equal((await new AndroidAdbBackend({ runner: unavailable }).probe(context(), { platform: 'android' })).reason, 'ADB_UNAVAILABLE');
});

test('activates by semantic target and never exposes coordinates to Flow', async () => {
  const runner = new FakeAdbRunner();
  const backend = new AndroidAdbBackend({ runner });
  await backend.open(context(), { platform: 'android', deviceId: 'emulator-5554' });
  const step = FlowSchema.parse({
    schemaVersion: 1,
    id: 'one',
    surfaceId: 'mobile-app',
    steps: [{ id: 'activate', type: 'activate', target: { strategy: 'automationId', value: 'create_button' } }],
  }).steps[0]!;
  const response = await backend.execute(step as never, context(), { platform: 'android', deviceId: 'emulator-5554' });
  assert.equal(response.status, 'passed');
  assert.ok(runner.calls.some((args) => args.join(' ').includes('shell input tap 540 545')));
  await backend.close(context(), { platform: 'android', deviceId: 'emulator-5554' });
});

test('captures real PNG bytes from adb screencap and rejects element capture', async () => {
  const runner = new FakeAdbRunner();
  const backend = new AndroidAdbBackend({ runner });
  await backend.open(context(), { platform: 'android', deviceId: 'emulator-5554' });
  const capture = FlowSchema.parse({
    schemaVersion: 1,
    id: 'one',
    surfaceId: 'mobile-app',
    steps: [{ id: 'capture', type: 'capture', evidenceId: 'screen', kind: 'screenshot' }],
  }).steps[0]!;
  const response = await backend.execute(capture as never, context(), { platform: 'android', deviceId: 'emulator-5554' });
  assert.equal(response.status, 'passed');
  assert.deepEqual(Buffer.from(response.capture!.bytes), ONE_PIXEL_PNG);

  const targeted = FlowSchema.parse({
    schemaVersion: 1,
    id: 'two',
    surfaceId: 'mobile-app',
    steps: [{ id: 'capture', type: 'capture', evidenceId: 'screen', kind: 'screenshot', target: { strategy: 'automationId', value: 'result' } }],
  }).steps[0]!;
  const targetedResponse = await backend.execute(targeted as never, context(), { platform: 'android', deviceId: 'emulator-5554' });
  assert.equal(targetedResponse.status, 'failed');
  assert.equal(targetedResponse.error?.code, 'BACKEND_CAPTURE_UNSUPPORTED');
});

test('supports conservative text input, key presses, waits/assertions, and semantic scrolling', async () => {
  const runner = new FakeAdbRunner();
  const backend = new AndroidAdbBackend({ runner, actionTimeoutMs: 500 });
  await backend.open(context(), { platform: 'android', deviceId: 'emulator-5554' });

  const steps = FlowSchema.parse({
    schemaVersion: 1,
    id: 'actions',
    surfaceId: 'mobile-app',
    steps: [
      { id: 'input', type: 'input', target: { strategy: 'automationId', value: 'project_name' }, value: 'Demo Project', clear: false },
      { id: 'press', type: 'press', key: 'Enter' },
      { id: 'wait', type: 'wait', condition: { kind: 'visible', target: { strategy: 'automationId', value: 'result' } }, timeoutMs: 200 },
      { id: 'assert', type: 'assert', assertion: { kind: 'textContains', target: { strategy: 'automationId', value: 'result' }, value: 'Demo Project' } },
      { id: 'scroll', type: 'scroll', direction: 'down', amount: 300 },
    ],
  }).steps;

  for (const step of steps) {
    const response = await backend.execute(step as never, context(), { platform: 'android', deviceId: 'emulator-5554' });
    assert.equal(response.status, 'passed', `${step.id}: ${response.error?.message ?? ''}`);
  }
  assert.ok(runner.calls.some((args) => args.join(' ').includes('shell input text Demo%sProject')));
  assert.ok(runner.calls.some((args) => args.join(' ').includes('shell input keyevent KEYCODE_ENTER')));
  assert.ok(runner.calls.some((args) => args.join(' ').includes('shell input swipe')));
});

test('rejects unsafe text and ambiguous semantic targets', async () => {
  const runner = new FakeAdbRunner();
  const backend = new AndroidAdbBackend({ runner });
  await backend.open(context(), { platform: 'android', deviceId: 'emulator-5554' });

  const unsafe = FlowSchema.parse({
    schemaVersion: 1,
    id: 'unsafe',
    surfaceId: 'mobile-app',
    steps: [{ id: 'input', type: 'input', target: { strategy: 'automationId', value: 'project_name' }, value: 'emoji 🚀' }],
  }).steps[0]!;
  const unsafeResponse = await backend.execute(unsafe as never, context(), { platform: 'android', deviceId: 'emulator-5554' });
  assert.equal(unsafeResponse.error?.code, 'UNSUPPORTED_INPUT_TEXT');

  runner.hierarchy = HIERARCHY.replace('</hierarchy>', '<node index="9" text="Create" resource-id="other:id/create_button" class="android.widget.Button" content-desc="Create project" clickable="true" enabled="true" focused="false" scrollable="false" bounds="[0,0][10,10]" /></hierarchy>');
  const activate = FlowSchema.parse({
    schemaVersion: 1,
    id: 'ambiguous',
    surfaceId: 'mobile-app',
    steps: [{ id: 'activate', type: 'activate', target: { strategy: 'automationId', value: 'create_button' } }],
  }).steps[0]!;
  const ambiguous = await backend.execute(activate as never, context(), { platform: 'android', deviceId: 'emulator-5554' });
  assert.equal(ambiguous.error?.code, 'TARGET_AMBIGUOUS');
});
