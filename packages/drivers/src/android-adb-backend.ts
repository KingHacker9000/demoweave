import { spawn } from 'node:child_process';
import type { InteractionTarget } from '@demoweave/core';
import type {
  MobileBackend,
  MobileBackendDescriptor,
  MobileBackendStep,
  MobileBackendStepResult,
  MobileRuntimeTarget,
} from './mobile-backend.js';
import type { DriverContext } from './index.js';

export const androidAdbBackendVersion = '0.0.1';

const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;
const DEVICE_DUMP_PATH = `/sdcard/demoweave-uia-${process.pid}.xml`;

const KEY_CODES: Record<string, string> = {
  Enter: 'KEYCODE_ENTER',
  Tab: 'KEYCODE_TAB',
  Escape: 'KEYCODE_BACK',
  ArrowUp: 'KEYCODE_DPAD_UP',
  ArrowDown: 'KEYCODE_DPAD_DOWN',
  ArrowLeft: 'KEYCODE_DPAD_LEFT',
  ArrowRight: 'KEYCODE_DPAD_RIGHT',
  Home: 'KEYCODE_MOVE_HOME',
  End: 'KEYCODE_MOVE_END',
};

const ROLE_CLASSES: Record<string, string[]> = {
  button: ['android.widget.Button'],
  checkbox: ['android.widget.CheckBox'],
  image: ['android.widget.ImageView'],
  list: ['android.widget.ListView', 'androidx.recyclerview.widget.RecyclerView'],
  switch: ['android.widget.Switch', 'android.widget.ToggleButton'],
  text: ['android.widget.TextView'],
  textbox: ['android.widget.EditText'],
};

export interface AdbCommandResult {
  exitCode: number | null;
  stdout: Buffer;
  stderr: string;
}

export interface AdbRunner {
  run(args: string[], timeoutMs?: number): Promise<AdbCommandResult>;
}

export interface ProcessAdbRunnerOptions {
  executable?: string;
  spawnProcess?: typeof spawn;
}

export interface AndroidAdbBackendOptions {
  runner?: AdbRunner;
  actionTimeoutMs?: number;
}

export class ProcessAdbRunner implements AdbRunner {
  private readonly executable: string;
  private readonly spawnProcess: typeof spawn;

  constructor(options: ProcessAdbRunnerOptions = {}) {
    this.executable = options.executable ?? 'adb';
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async run(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<AdbCommandResult> {
    return await new Promise((resolve) => {
      let settled = false;
      const stdout: Buffer[] = [];
      let stderr = '';
      let timer: NodeJS.Timeout | undefined;
      const finish = (result: AdbCommandResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      let child;
      try {
        child = this.spawnProcess(this.executable, args, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        finish({ exitCode: null, stdout: Buffer.alloc(0), stderr: error instanceof Error ? error.message : String(error) });
        return;
      }
      child.stdout?.on('data', (chunk: Buffer | string) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', (error) => finish({ exitCode: null, stdout: Buffer.concat(stdout), stderr: error.message }));
      child.once('close', (code) => finish({ exitCode: code, stdout: Buffer.concat(stdout), stderr }));
      timer = setTimeout(() => {
        child.kill();
        finish({ exitCode: null, stdout: Buffer.concat(stdout), stderr: `ADB command timed out after ${timeoutMs}ms` });
      }, timeoutMs);
    });
  }
}

type AndroidNode = {
  text: string;
  resourceId: string;
  className: string;
  contentDescription: string;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  scrollable: boolean;
  bounds: { left: number; top: number; right: number; bottom: number };
};

function passed(): MobileBackendStepResult {
  return { status: 'passed' };
}

function failed(code: string, message: string): MobileBackendStepResult {
  return { status: 'failed', error: { code, message } };
}

function xmlDecode(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseBoolean(value: string | undefined): boolean {
  return value === 'true';
}

function parseBounds(value: string | undefined): AndroidNode['bounds'] | undefined {
  const match = value?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!match) return undefined;
  const [, left, top, right, bottom] = match;
  return {
    left: Number(left),
    top: Number(top),
    right: Number(right),
    bottom: Number(bottom),
  };
}

export function parseAndroidUiHierarchy(xml: string): AndroidNode[] {
  const nodes: AndroidNode[] = [];
  const nodePattern = /<node\s+([^>]*?)(?:\/?>)/g;
  for (const match of xml.matchAll(nodePattern)) {
    const attributes = new Map<string, string>();
    for (const attribute of match[1]!.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attributes.set(attribute[1]!, xmlDecode(attribute[2]!));
    }
    const bounds = parseBounds(attributes.get('bounds'));
    if (!bounds) continue;
    nodes.push({
      text: attributes.get('text') ?? '',
      resourceId: attributes.get('resource-id') ?? '',
      className: attributes.get('class') ?? '',
      contentDescription: attributes.get('content-desc') ?? '',
      clickable: parseBoolean(attributes.get('clickable')),
      enabled: attributes.get('enabled') !== 'false',
      focused: parseBoolean(attributes.get('focused')),
      scrollable: parseBoolean(attributes.get('scrollable')),
      bounds,
    });
  }
  return nodes;
}

function identifierMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.endsWith(`/${expected}`);
}

function stringMatches(actual: string, expected: string, exact = true): boolean {
  return exact ? actual === expected : actual.includes(expected);
}

export function androidNodeMatchesTarget(node: AndroidNode, target: InteractionTarget): boolean {
  const exact = target.exact ?? true;
  if (target.strategy === 'automationId' || target.strategy === 'testId') {
    return identifierMatches(node.resourceId, target.value);
  }
  if (target.strategy === 'accessibilityId') {
    return stringMatches(node.contentDescription, target.value, exact);
  }
  if (target.strategy === 'text') return stringMatches(node.text, target.value, exact);
  if (target.strategy === 'label' || target.strategy === 'name') {
    return stringMatches(node.contentDescription, target.value, exact) || stringMatches(node.text, target.value, exact);
  }
  if (target.strategy === 'role') {
    const classes = ROLE_CLASSES[target.value.toLowerCase()];
    return Boolean(classes?.includes(node.className));
  }
  return false;
}

function center(node: AndroidNode): { x: number; y: number } {
  return {
    x: Math.round((node.bounds.left + node.bounds.right) / 2),
    y: Math.round((node.bounds.top + node.bounds.bottom) / 2),
  };
}

function parseDevices(stdout: string): Array<{ id: string; state: string }> {
  return stdout.split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id = '', state = ''] = line.split(/\s+/, 2);
      return { id, state };
    })
    .filter((device) => device.id);
}

function safeAsciiInput(value: string): boolean {
  return /^[A-Za-z0-9 _.,:+\-@/]*$/.test(value);
}

function encodeAdbText(value: string): string {
  return value.replaceAll('%', '%25').replaceAll(' ', '%s');
}

export class AndroidAdbBackend implements MobileBackend {
  readonly descriptor: MobileBackendDescriptor = {
    id: 'android-adb',
    apiVersion: 1 as const,
    version: androidAdbBackendVersion,
    platforms: ['android'],
    stepTypes: ['activate', 'input', 'press', 'scroll', 'wait', 'assert', 'capture'],
    capabilities: ['semantic-control', 'text-input', 'keyboard-input', 'scroll', 'screen-capture'],
  };

  private readonly runner: AdbRunner;
  private readonly actionTimeoutMs: number;
  private deviceId?: string;
  private opened = false;

  constructor(options: AndroidAdbBackendOptions = {}) {
    this.runner = options.runner ?? new ProcessAdbRunner();
    this.actionTimeoutMs = options.actionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async probe(_context: DriverContext, target: MobileRuntimeTarget): Promise<{ available: boolean; reason?: string; detail?: string }> {
    if (target.platform !== 'android') return { available: false, reason: 'UNSUPPORTED_PLATFORM', detail: 'Android ADB backend supports Android only.' };
    const version = await this.runner.run(['version'], this.actionTimeoutMs);
    if (version.exitCode !== 0) {
      return { available: false, reason: 'ADB_UNAVAILABLE', detail: version.stderr || 'adb could not be started' };
    }
    const devicesResult = await this.runner.run(['devices'], this.actionTimeoutMs);
    if (devicesResult.exitCode !== 0) {
      return { available: false, reason: 'ADB_DEVICES_FAILED', detail: devicesResult.stderr || 'adb devices failed' };
    }
    const devices = parseDevices(devicesResult.stdout.toString('utf8'));
    if (target.deviceId) {
      const match = devices.find((device) => device.id === target.deviceId);
      if (!match) return { available: false, reason: 'MOBILE_DEVICE_NOT_FOUND', detail: `Android device ${target.deviceId} is not listed by adb.` };
      if (match.state !== 'device') return { available: false, reason: 'MOBILE_DEVICE_UNAVAILABLE', detail: `Android device ${target.deviceId} is ${match.state}.` };
      this.deviceId = target.deviceId;
      return { available: true };
    }
    const ready = devices.filter((device) => device.state === 'device');
    if (ready.length === 0) return { available: false, reason: 'MOBILE_DEVICE_NOT_FOUND', detail: 'No ready Android device/emulator is listed by adb.' };
    if (ready.length > 1) return { available: false, reason: 'MOBILE_DEVICE_ID_REQUIRED', detail: 'Multiple Android devices are ready; pass --mobile-device-id <serial>.' };
    this.deviceId = ready[0]!.id;
    return { available: true, detail: `Using the only ready Android device: ${this.deviceId}` };
  }

  async open(_context: DriverContext, target: MobileRuntimeTarget): Promise<void> {
    if (!this.deviceId) {
      const probe = await this.probe(_context, target);
      if (!probe.available) throw new Error(`${probe.reason ?? 'ANDROID_ADB_UNAVAILABLE'}: ${probe.detail ?? 'Android ADB backend is unavailable'}`);
    }
    this.opened = true;
  }

  async execute(step: MobileBackendStep, _context: DriverContext, _target: MobileRuntimeTarget): Promise<MobileBackendStepResult> {
    if (!this.opened || !this.deviceId) return failed('BACKEND_NOT_OPEN', 'Android ADB backend is not attached to a device');
    if (step.type === 'activate') return await this.activate(step.target);
    if (step.type === 'input') return await this.input(step.target, step.value, step.clear ?? false);
    if (step.type === 'press') return await this.press(step.key, step.target);
    if (step.type === 'scroll') return await this.scroll(step.direction, step.amount, step.target);
    if (step.type === 'wait') return await this.wait(step);
    if (step.type === 'assert') return await this.assert(step);
    if (step.type === 'capture') {
      if (step.target) return failed('BACKEND_CAPTURE_UNSUPPORTED', 'Android ADB M13 captures the device screen only; element capture is not implemented.');
      const result = await this.device(['exec-out', 'screencap', '-p']);
      if (result.exitCode !== 0) return failed('SCREEN_CAPTURE_FAILED', result.stderr || 'adb screencap failed');
      return { status: 'passed', capture: { format: 'png', bytes: result.stdout } };
    }
    return failed('BACKEND_UNSUPPORTED_ACTION', `Android ADB does not support Flow action ${(step as { type: string }).type}`);
  }

  async close(): Promise<void> {
    if (this.deviceId) await this.device(['shell', 'rm', '-f', DEVICE_DUMP_PATH]).catch(() => undefined);
    this.opened = false;
    this.deviceId = undefined;
  }

  private async device(args: string[]): Promise<AdbCommandResult> {
    if (!this.deviceId) return { exitCode: null, stdout: Buffer.alloc(0), stderr: 'Android device is not selected' };
    return await this.runner.run(['-s', this.deviceId, ...args], this.actionTimeoutMs);
  }

  private async hierarchy(): Promise<AndroidNode[] | MobileBackendStepResult> {
    const dump = await this.device(['shell', 'uiautomator', 'dump', '--compressed', DEVICE_DUMP_PATH]);
    if (dump.exitCode !== 0) return failed('UI_HIERARCHY_FAILED', dump.stderr || dump.stdout.toString('utf8') || 'uiautomator dump failed');
    try {
      const read = await this.device(['exec-out', 'cat', DEVICE_DUMP_PATH]);
      if (read.exitCode !== 0) return failed('UI_HIERARCHY_FAILED', read.stderr || 'Could not read Android UI hierarchy');
      return parseAndroidUiHierarchy(read.stdout.toString('utf8'));
    } finally {
      await this.device(['shell', 'rm', '-f', DEVICE_DUMP_PATH]).catch(() => undefined);
    }
  }

  private async resolve(target: InteractionTarget, allowMissing = false): Promise<AndroidNode | undefined | MobileBackendStepResult> {
    const hierarchy = await this.hierarchy();
    if (!Array.isArray(hierarchy)) return hierarchy;
    const matches = hierarchy.filter((node) => androidNodeMatchesTarget(node, target));
    if (matches.length === 0) return allowMissing ? undefined : failed('TARGET_NOT_FOUND', `Android target not found: ${target.strategy}=${JSON.stringify(target.value)}`);
    if (matches.length > 1) return failed('TARGET_AMBIGUOUS', `Android target matched ${matches.length} elements: ${target.strategy}=${JSON.stringify(target.value)}`);
    return matches[0]!;
  }

  private async activate(target: InteractionTarget): Promise<MobileBackendStepResult> {
    const node = await this.resolve(target);
    if (!node || 'status' in node) return node ?? failed('TARGET_NOT_FOUND', 'Android target not found');
    if (!node.enabled || !node.clickable) return failed('TARGET_NOT_ACTIVATABLE', 'Android target is not enabled and clickable');
    const point = center(node);
    const result = await this.device(['shell', 'input', 'tap', String(point.x), String(point.y)]);
    return result.exitCode === 0 ? passed() : failed('ACTIVATE_FAILED', result.stderr || 'adb input tap failed');
  }

  private async input(target: InteractionTarget, value: string, clear: boolean): Promise<MobileBackendStepResult> {
    if (!safeAsciiInput(value)) return failed('UNSUPPORTED_INPUT_TEXT', 'Android ADB M13 text input currently supports conservative printable ASCII only.');
    const node = await this.resolve(target);
    if (!node || 'status' in node) return node ?? failed('TARGET_NOT_FOUND', 'Android input target not found');
    if (!node.enabled) return failed('TARGET_NOT_EDITABLE', 'Android input target is disabled');
    const point = center(node);
    const focus = await this.device(['shell', 'input', 'tap', String(point.x), String(point.y)]);
    if (focus.exitCode !== 0) return failed('INPUT_FOCUS_FAILED', focus.stderr || 'Could not focus Android input target');
    if (clear) {
      const moveEnd = await this.device(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']);
      if (moveEnd.exitCode !== 0) return failed('INPUT_CLEAR_FAILED', moveEnd.stderr || 'Could not move to the end of Android input text');
      for (const _character of Array.from(node.text)) {
        const remove = await this.device(['shell', 'input', 'keyevent', 'KEYCODE_DEL']);
        if (remove.exitCode !== 0) return failed('INPUT_CLEAR_FAILED', remove.stderr || 'Could not clear Android input text');
      }
    }
    if (!value) return passed();
    const result = await this.device(['shell', 'input', 'text', encodeAdbText(value)]);
    return result.exitCode === 0 ? passed() : failed('INPUT_FAILED', result.stderr || 'adb input text failed');
  }

  private async press(key: string, target?: InteractionTarget): Promise<MobileBackendStepResult> {
    const keyCode = KEY_CODES[key];
    if (!keyCode) return failed('UNSUPPORTED_KEY', `Android ADB does not support key ${key}`);
    if (target) {
      const node = await this.resolve(target);
      if (!node || 'status' in node) return node ?? failed('TARGET_NOT_FOUND', 'Android key target not found');
      const point = center(node);
      const focus = await this.device(['shell', 'input', 'tap', String(point.x), String(point.y)]);
      if (focus.exitCode !== 0) return failed('INPUT_FOCUS_FAILED', focus.stderr || 'Could not focus Android target before key press');
    }
    const result = await this.device(['shell', 'input', 'keyevent', keyCode]);
    return result.exitCode === 0 ? passed() : failed('PRESS_FAILED', result.stderr || 'adb keyevent failed');
  }

  private async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number, target?: InteractionTarget): Promise<MobileBackendStepResult> {
    let bounds: AndroidNode['bounds'];
    if (target) {
      const node = await this.resolve(target);
      if (!node || 'status' in node) return node ?? failed('TARGET_NOT_FOUND', 'Android scroll target not found');
      if (!node.scrollable) return failed('TARGET_NOT_SCROLLABLE', 'Android target is not marked scrollable');
      bounds = node.bounds;
    } else {
      const size = await this.device(['shell', 'wm', 'size']);
      const match = size.stdout.toString('utf8').match(/(?:Override|Physical) size:\s*(\d+)x(\d+)/g)?.at(-1)?.match(/(\d+)x(\d+)/);
      if (!match) return failed('SCREEN_SIZE_FAILED', size.stderr || 'Could not determine Android screen size');
      bounds = { left: 0, top: 0, right: Number(match[1]), bottom: Number(match[2]) };
    }
    const width = Math.max(1, bounds.right - bounds.left);
    const height = Math.max(1, bounds.bottom - bounds.top);
    const distance = Math.round(Math.min(amount ?? Math.max(80, Math.min(width, height) * 0.45), direction === 'up' || direction === 'down' ? height * 0.7 : width * 0.7));
    const cx = Math.round((bounds.left + bounds.right) / 2);
    const cy = Math.round((bounds.top + bounds.bottom) / 2);
    let startX = cx; let startY = cy; let endX = cx; let endY = cy;
    if (direction === 'down') { startY = cy + Math.round(distance / 2); endY = cy - Math.round(distance / 2); }
    if (direction === 'up') { startY = cy - Math.round(distance / 2); endY = cy + Math.round(distance / 2); }
    if (direction === 'right') { startX = cx + Math.round(distance / 2); endX = cx - Math.round(distance / 2); }
    if (direction === 'left') { startX = cx - Math.round(distance / 2); endX = cx + Math.round(distance / 2); }
    const result = await this.device(['shell', 'input', 'swipe', String(startX), String(startY), String(endX), String(endY), '250']);
    return result.exitCode === 0 ? passed() : failed('SCROLL_FAILED', result.stderr || 'adb input swipe failed');
  }

  private async wait(step: Extract<MobileBackendStep, { type: 'wait' }>): Promise<MobileBackendStepResult> {
    const timeoutMs = step.timeoutMs ?? this.actionTimeoutMs;
    const condition = step.condition;
    if (condition.kind === 'duration') {
      if (condition.ms > timeoutMs) return failed('WAIT_TIMEOUT', `Duration wait exceeded its ${timeoutMs}ms timeout`);
      await new Promise((resolve) => setTimeout(resolve, condition.ms));
      return passed();
    }
    if (condition.kind !== 'visible' && condition.kind !== 'hidden' && condition.kind !== 'text') {
      return failed('UNSUPPORTED_WAIT', `Android ADB does not support wait condition ${condition.kind}`);
    }
    if (condition.kind === 'text' && !condition.target) return failed('UNSUPPORTED_WAIT', 'Android text waits require a semantic target');
    const target = condition.target!;
    const started = Date.now();
    do {
      const node = await this.resolve(target, condition.kind === 'hidden');
      if (node && 'status' in node) return node;
      if (condition.kind === 'visible' && node) return passed();
      if (condition.kind === 'hidden' && !node) return passed();
      if (condition.kind === 'text' && node && (node.text.includes(condition.value) || node.contentDescription.includes(condition.value))) return passed();
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, timeoutMs)));
    } while (Date.now() - started < timeoutMs);
    return failed('WAIT_TIMEOUT', `Android ${condition.kind} wait exceeded ${timeoutMs}ms`);
  }

  private async assert(step: Extract<MobileBackendStep, { type: 'assert' }>): Promise<MobileBackendStepResult> {
    const assertion = step.assertion;
    if (assertion.kind !== 'visible' && assertion.kind !== 'hidden' && assertion.kind !== 'textContains') {
      return failed('UNSUPPORTED_ASSERTION', `Android ADB does not support assertion ${assertion.kind}`);
    }
    if (assertion.kind === 'textContains' && !assertion.target) return failed('UNSUPPORTED_ASSERTION', 'Android text assertions require a semantic target');
    const node = await this.resolve(assertion.target!, assertion.kind === 'hidden');
    if (node && 'status' in node) return node;
    if (assertion.kind === 'visible') return node ? passed() : failed('ASSERTION_FAILED', 'Expected Android target to be visible');
    if (assertion.kind === 'hidden') return !node ? passed() : failed('ASSERTION_FAILED', 'Expected Android target to be hidden');
    const actual = node ? `${node.text}\n${node.contentDescription}` : '';
    return actual.includes(assertion.value)
      ? passed()
      : failed('ASSERTION_FAILED', `Expected Android target text to contain ${JSON.stringify(assertion.value)}`);
  }
}
