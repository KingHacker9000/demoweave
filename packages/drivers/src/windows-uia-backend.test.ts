import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { FlowSchema, type InteractionTarget } from '@demoweave/core';
import type { DesktopBackendStep } from './desktop-backend.js';
import type { DesktopHostCapabilities } from './desktop-capabilities.js';
import type { DriverContext } from './index.js';
import {
  PowerShellWindowsUiaHelper,
  WindowsUiaBackend,
  type WindowsUiaHelper,
  type WindowsUiaRequest,
  type WindowsUiaResponse,
} from './windows-uia-backend.js';

const WINDOWS_HOST: DesktopHostCapabilities = {
  platform: 'windows', sessionKind: 'windows-session', interactiveSession: 'present', detail: 'test session',
};
const LINUX_HOST: DesktopHostCapabilities = {
  platform: 'linux', sessionKind: 'headless', interactiveSession: 'absent', detail: 'test host',
};
const TARGET: InteractionTarget = { strategy: 'automationId', value: 'project-name' };
const CONTEXT = {} as DriverContext;

class FakeHelper implements WindowsUiaHelper {
  readonly requests: WindowsUiaRequest[] = [];
  constructor(private readonly respond: (request: WindowsUiaRequest) => WindowsUiaResponse = () => ({ ok: true })) {}
  async request(request: WindowsUiaRequest): Promise<WindowsUiaResponse> {
    this.requests.push(request);
    return this.respond(request);
  }
}

function backend(helper: WindowsUiaHelper, options: { pid?: number; timeout?: number } = {}): WindowsUiaBackend {
  return new WindowsUiaBackend({
    desktopPid: options.pid ?? 42,
    actionTimeoutMs: options.timeout ?? 10,
    hostCapabilities: WINDOWS_HOST,
    helper,
  });
}

function step(value: unknown): DesktopBackendStep {
  return FlowSchema.parse({ schemaVersion: 1, id: 'test', surfaceId: 'desktop', steps: [value] }).steps[0] as DesktopBackendStep;
}

async function opened(value: WindowsUiaBackend): Promise<WindowsUiaBackend> {
  assert.equal((await value.probe()).available, true);
  await value.open();
  return value;
}

test('is Windows-only and requires a strictly positive explicit PID', async () => {
  const nonWindows = new WindowsUiaBackend({ desktopPid: 42, hostCapabilities: LINUX_HOST, helper: new FakeHelper() });
  assert.deepEqual(await nonWindows.probe(), {
    available: false, reason: 'UNSUPPORTED_PLATFORM', detail: 'Windows UI Automation is available only on Windows.',
  });
  const missing = new WindowsUiaBackend({ hostCapabilities: WINDOWS_HOST, helper: new FakeHelper() });
  assert.equal((await missing.probe()).reason, 'DESKTOP_PID_REQUIRED');
  const invalid = new WindowsUiaBackend({ desktopPid: 0, hostCapabilities: WINDOWS_HOST, helper: new FakeHelper() });
  assert.equal((await invalid.probe()).reason, 'INVALID_DESKTOP_PID');
});

for (const [code, label] of [
  ['PROCESS_NOT_FOUND', 'missing process'],
  ['NO_TOP_LEVEL_WINDOW', 'process without a top-level window'],
  ['MULTIPLE_TOP_LEVEL_WINDOWS', 'process with ambiguous top-level windows'],
  ['INTERACTIVE_SESSION_UNAVAILABLE', 'unavailable interactive session'],
  ['HELPER_UNAVAILABLE', 'unavailable helper'],
] as const) {
  test(`probe preserves ${label} diagnostics`, async () => {
    const value = backend(new FakeHelper(() => ({ ok: false, error: { code, message: label } })));
    assert.deepEqual(await value.probe(), { available: false, reason: code, detail: label });
  });
}

test('uses a base semantic request protocol and preserves input replacement/append intent', async () => {
  const helper = new FakeHelper();
  const value = await opened(backend(helper));
  assert.equal((await value.execute(step({ id: 'activate', type: 'activate', target: TARGET }), CONTEXT)).status, 'passed');
  assert.equal((await value.execute(step({ id: 'input', type: 'input', target: TARGET, value: 'Demo', clear: true }), CONTEXT)).status, 'passed');
  assert.deepEqual(helper.requests, [
    { operation: 'attach', pid: 42 },
    { operation: 'activate', pid: 42, target: TARGET },
    { operation: 'input', pid: 42, target: TARGET, value: 'Demo', clear: true },
  ]);
});

for (const [code, type] of [
  ['UNSUPPORTED_TARGET_STRATEGY', 'activate'],
  ['TARGET_NOT_FOUND', 'activate'],
  ['TARGET_AMBIGUOUS', 'activate'],
  ['ACTIVATION_PATTERN_UNAVAILABLE', 'activate'],
  ['VALUE_PATTERN_UNAVAILABLE', 'input'],
] as const) {
  test(`preserves helper error ${code}`, async () => {
    const helper = new FakeHelper((request) => request.operation === 'attach'
      ? { ok: true }
      : { ok: false, error: { code, message: code } });
    const value = await opened(backend(helper));
    const action = type === 'activate'
      ? step({ id: 'action', type, target: TARGET })
      : step({ id: 'action', type, target: TARGET, value: 'x' });
    const result = await value.execute(action, CONTEXT);
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, code);
  });
}

test('keeps supported press keys explicit and focuses a supplied semantic target through the helper', async () => {
  const helper = new FakeHelper();
  const value = await opened(backend(helper));
  const supported = await value.execute(step({ id: 'press', type: 'press', key: 'Enter', target: TARGET }), CONTEXT);
  assert.equal(supported.status, 'passed');
  assert.deepEqual(helper.requests.at(-1), { operation: 'press', pid: 42, key: 'Enter', target: TARGET });
  const unsupported = await value.execute(step({ id: 'press', type: 'press', key: 'F13' }), CONTEXT);
  assert.equal(unsupported.error?.code, 'UNSUPPORTED_KEY');
});

test('preserves foreground ownership failures from native key injection', async () => {
  const helper = new FakeHelper((request) => request.operation === 'press'
    ? { ok: false, error: { code: 'FOREGROUND_WINDOW_MISMATCH', message: 'foreground mismatch' } }
    : { ok: true });
  const value = await opened(backend(helper));
  const result = await value.execute(step({ id: 'press', type: 'press', key: 'Enter', target: TARGET }), CONTEXT);
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'FOREGROUND_WINDOW_MISMATCH');
});

test('bounds visible waits and reports a stable timeout', async () => {
  const helper = new FakeHelper((request) => request.operation === 'inspect'
    ? { ok: true, element: { exists: true, visible: false, name: '' } }
    : { ok: true });
  const value = await opened(backend(helper, { timeout: 1 }));
  const result = await value.execute(step({
    id: 'wait', type: 'wait', timeoutMs: 1, condition: { kind: 'visible', target: TARGET },
  }), CONTEXT);
  assert.equal(result.error?.code, 'WAIT_TIMEOUT');
});

test('supports hidden/text waits and visible/hidden/text assertions from helper inspection', async () => {
  const helper = new FakeHelper((request) => request.operation === 'inspect'
    ? { ok: true, element: { exists: true, visible: true, name: 'Created Demo Project' } }
    : { ok: true });
  const value = await opened(backend(helper));
  assert.equal((await value.execute(step({
    id: 'wait', type: 'wait', condition: { kind: 'text', target: TARGET, value: 'Demo Project' },
  }), CONTEXT)).status, 'passed');
  assert.equal((await value.execute(step({
    id: 'visible', type: 'assert', assertion: { kind: 'visible', target: TARGET },
  }), CONTEXT)).status, 'passed');
  assert.equal((await value.execute(step({
    id: 'text', type: 'assert', assertion: { kind: 'textContains', target: TARGET, value: 'Demo Project' },
  }), CONTEXT)).status, 'passed');
  const hidden = await value.execute(step({ id: 'hidden', type: 'assert', assertion: { kind: 'hidden', target: TARGET } }), CONTEXT);
  assert.equal(hidden.error?.code, 'ASSERTION_FAILED');
});

test('returns real helper PNG bytes and preserves window-capture failure', async () => {
  const png = Buffer.from('iVBORw0KGgo=', 'base64');
  const success = await opened(backend(new FakeHelper((request) => request.operation === 'capture'
    ? { ok: true, capture: { pngBase64: png.toString('base64'), width: 12, height: 8 } }
    : { ok: true })));
  const capture = await success.execute(step({ id: 'capture', type: 'capture', evidenceId: 'proof', kind: 'screenshot' }), CONTEXT);
  assert.deepEqual(Buffer.from(capture.capture?.bytes ?? []), png);
  assert.equal(capture.capture?.width, 12);

  const failure = await opened(backend(new FakeHelper((request) => request.operation === 'capture'
    ? { ok: false, error: { code: 'WINDOW_CAPTURE_FAILED', message: 'PrintWindow failed' } }
    : { ok: true })));
  const failed = await failure.execute(step({ id: 'capture', type: 'capture', evidenceId: 'proof', kind: 'screenshot' }), CONTEXT);
  assert.equal(failed.error?.code, 'WINDOW_CAPTURE_FAILED');
});

test('real PowerShell helper starts and returns its structured protocol on hosted Windows', { skip: process.platform !== 'win32' }, async () => {
  const helper = new PowerShellWindowsUiaHelper();
  const response = await helper.request({ operation: 'attach', pid: 2_147_483_647 });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, 'PROCESS_NOT_FOUND');
  assert.match(response.error?.message ?? '', /does not exist/i);
});

test('helper is shell-safe, PID-scoped for key injection, maps semantic properties explicitly, and uses no temporary capture', async () => {
  const script = await fs.readFile(path.join(import.meta.dirname, 'windows-uia-helper.ps1'), 'utf8');
  assert.doesNotMatch(script, /Invoke-Expression/i);
  assert.match(script, /TreeScope\]::Descendants/);
  assert.match(script, /AutomationIdProperty/);
  assert.match(script, /Name/);
  assert.match(script, /ControlTypeProperty/);
  assert.match(script, /testId has no defined Windows UI Automation mapping/);
  assert.match(script, /GetForegroundWindow/);
  assert.match(script, /GetWindowThreadProcessId/);
  assert.match(script, /FOREGROUND_WINDOW_MISMATCH/);
  assert.match(script, /MemoryStream/);
  assert.doesNotMatch(script, /GetTemp|TEMP|WriteAllBytes/i);
});
