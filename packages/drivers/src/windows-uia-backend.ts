import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InteractionTarget } from '@demoweave/core';
import type {
  DesktopBackend,
  DesktopBackendDescriptor,
  DesktopBackendStep,
  DesktopBackendStepResult,
} from './desktop-backend.js';
import { getDesktopHostCapabilities, type DesktopHostCapabilities } from './desktop-capabilities.js';
import type { DriverContext } from './index.js';

export const windowsUiaBackendVersion = '0.0.1';

const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;
const MAX_WINDOWS_PID = 2_147_483_647;
const SUPPORTED_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
]);

export type WindowsUiaRequest =
  | { operation: 'attach'; pid: number }
  | { operation: 'activate'; pid: number; target: InteractionTarget }
  | { operation: 'input'; pid: number; target: InteractionTarget; value: string; clear: boolean }
  | { operation: 'press'; pid: number; key: string; target?: InteractionTarget }
  | { operation: 'inspect'; pid: number; target: InteractionTarget; allowMissing: boolean }
  | { operation: 'capture'; pid: number };

export type WindowsUiaResponse = {
  ok: boolean;
  error?: { code: string; message: string };
  window?: { handle: number; name: string };
  element?: { exists: boolean; visible?: boolean; name?: string };
  capture?: { pngBase64: string; width: number; height: number };
};

export interface WindowsUiaHelper {
  request(request: WindowsUiaRequest): Promise<WindowsUiaResponse>;
}

export interface PowerShellWindowsUiaHelperOptions {
  executable?: string;
  scriptPath?: string;
  spawnProcess?: typeof spawn;
}

export interface WindowsUiaBackendOptions {
  desktopPid?: number;
  actionTimeoutMs?: number;
  hostCapabilities?: DesktopHostCapabilities;
  helper?: WindowsUiaHelper;
}

function protocolFailure(message: string): WindowsUiaResponse {
  return { ok: false, error: { code: 'HELPER_PROTOCOL_ERROR', message } };
}

function parseResponse(stdout: string): WindowsUiaResponse {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return protocolFailure('Windows UI Automation helper returned invalid JSON');
  }
  if (!value || typeof value !== 'object' || typeof (value as { ok?: unknown }).ok !== 'boolean') {
    return protocolFailure('Windows UI Automation helper response is missing its ok field');
  }
  const response = value as WindowsUiaResponse;
  if (!response.ok && (!response.error || typeof response.error.code !== 'string' || typeof response.error.message !== 'string')) {
    return protocolFailure('Windows UI Automation helper failure is missing a stable error code');
  }
  return response;
}

export class PowerShellWindowsUiaHelper implements WindowsUiaHelper {
  private readonly executable: string;
  private readonly scriptPath: string;
  private readonly spawnProcess: typeof spawn;

  constructor(options: PowerShellWindowsUiaHelperOptions = {}) {
    this.executable = options.executable ?? (process.platform === 'win32'
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe');
    this.scriptPath = options.scriptPath ?? fileURLToPath(new URL('./windows-uia-helper.ps1', import.meta.url));
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async request(request: WindowsUiaRequest): Promise<WindowsUiaResponse> {
    const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
    return await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const child = this.spawnProcess(this.executable, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', this.scriptPath, '-RequestBase64', encoded,
      ], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const finish = (response: WindowsUiaResponse) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
      child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', (error) => finish({
        ok: false,
        error: { code: 'HELPER_UNAVAILABLE', message: `Windows UI Automation helper could not start: ${error.message}` },
      }));
      child.once('close', (code) => {
        if (code !== 0 && !stdout.trim()) {
          finish({
            ok: false,
            error: {
              code: 'HELPER_UNAVAILABLE',
              message: `Windows UI Automation helper exited with code ${code ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
            },
          });
          return;
        }
        finish(parseResponse(stdout));
      });
    });
  }
}

function passed(): DesktopBackendStepResult {
  return { status: 'passed' };
}

function failed(code: string, message: string): DesktopBackendStepResult {
  return { status: 'failed', error: { code, message } };
}

function helperFailure(response: WindowsUiaResponse): DesktopBackendStepResult {
  return failed(response.error?.code ?? 'HELPER_PROTOCOL_ERROR', response.error?.message ?? 'Windows UI Automation helper failed');
}

function validPid(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 && (value ?? 0) <= MAX_WINDOWS_PID;
}

export class WindowsUiaBackend implements DesktopBackend {
  readonly descriptor: DesktopBackendDescriptor = {
    id: 'windows-uia',
    apiVersion: 1 as const,
    version: windowsUiaBackendVersion,
    platforms: ['windows'],
    stepTypes: ['activate', 'input', 'press', 'wait', 'assert', 'capture'],
    capabilities: ['semantic-control', 'text-input', 'keyboard-input', 'window-capture'],
  };

  private readonly desktopPid?: number;
  private readonly actionTimeoutMs: number;
  private readonly hostCapabilities: DesktopHostCapabilities;
  private readonly helper: WindowsUiaHelper;
  private attached = false;

  constructor(options: WindowsUiaBackendOptions = {}) {
    this.desktopPid = options.desktopPid;
    this.actionTimeoutMs = options.actionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.hostCapabilities = options.hostCapabilities ?? getDesktopHostCapabilities();
    this.helper = options.helper ?? new PowerShellWindowsUiaHelper();
  }

  async probe(): Promise<{ available: boolean; reason?: string; detail?: string }> {
    if (this.hostCapabilities.platform !== 'windows') {
      return { available: false, reason: 'UNSUPPORTED_PLATFORM', detail: 'Windows UI Automation is available only on Windows.' };
    }
    if (this.hostCapabilities.interactiveSession === 'absent') {
      return { available: false, reason: 'INTERACTIVE_SESSION_UNAVAILABLE', detail: this.hostCapabilities.detail };
    }
    if (this.desktopPid === undefined) {
      return { available: false, reason: 'DESKTOP_PID_REQUIRED', detail: 'An explicit --desktop-pid <pid> is required.' };
    }
    if (!validPid(this.desktopPid)) {
      return {
        available: false,
        reason: 'INVALID_DESKTOP_PID',
        detail: `Desktop PID must be an integer between 1 and ${MAX_WINDOWS_PID}.`,
      };
    }
    const response = await this.helper.request({ operation: 'attach', pid: this.desktopPid });
    if (!response.ok) return { available: false, reason: response.error?.code, detail: response.error?.message };
    this.attached = true;
    return { available: true };
  }

  async open(): Promise<void> {
    if (!validPid(this.desktopPid)) throw new Error('A valid desktop PID is required before opening Windows UI Automation');
    if (!this.attached) {
      const response = await this.helper.request({ operation: 'attach', pid: this.desktopPid });
      if (!response.ok) throw new Error(`${response.error?.code ?? 'ATTACH_FAILED'}: ${response.error?.message ?? 'Windows UI Automation attach failed'}`);
    }
    this.attached = true;
  }

  async execute(step: DesktopBackendStep, _context: DriverContext): Promise<DesktopBackendStepResult> {
    if (!this.attached || !validPid(this.desktopPid)) return failed('BACKEND_NOT_OPEN', 'Windows UI Automation backend is not attached');
    if (step.type === 'scroll') return failed('BACKEND_UNSUPPORTED_ACTION', 'Windows UI Automation scroll is not implemented in M12B');
    if (step.type === 'activate') return await this.simple({ operation: 'activate', pid: this.desktopPid, target: step.target });
    if (step.type === 'input') {
      return await this.simple({
        operation: 'input', pid: this.desktopPid, target: step.target, value: step.value, clear: step.clear ?? false,
      });
    }
    if (step.type === 'press') {
      if (!SUPPORTED_KEYS.has(step.key)) return failed('UNSUPPORTED_KEY', `Windows UI Automation does not support key ${step.key}`);
      return await this.simple({
        operation: 'press', pid: this.desktopPid, key: step.key, ...(step.target ? { target: step.target } : {}),
      });
    }
    if (step.type === 'wait') return await this.wait(step);
    if (step.type === 'assert') return await this.assert(step);
    if (step.type === 'capture') {
      if (step.target) return failed('BACKEND_CAPTURE_UNSUPPORTED', 'Windows UI Automation M12B captures only the attached top-level window');
      const response = await this.helper.request({ operation: 'capture', pid: this.desktopPid });
      if (!response.ok) return helperFailure(response);
      if (!response.capture?.pngBase64) return failed('HELPER_PROTOCOL_ERROR', 'Windows UI Automation helper returned no PNG capture');
      return {
        status: 'passed',
        capture: {
          format: 'png',
          bytes: Buffer.from(response.capture.pngBase64, 'base64'),
          width: response.capture.width,
          height: response.capture.height,
        },
      };
    }
    return failed('BACKEND_UNSUPPORTED_ACTION', `Windows UI Automation does not support Flow action ${(step as { type: string }).type}`);
  }

  async close(): Promise<void> {
    this.attached = false;
  }

  private async simple(request: WindowsUiaRequest): Promise<DesktopBackendStepResult> {
    const response = await this.helper.request(request);
    return response.ok ? passed() : helperFailure(response);
  }

  private async inspect(target: InteractionTarget, allowMissing: boolean): Promise<WindowsUiaResponse> {
    return await this.helper.request({ operation: 'inspect', pid: this.desktopPid!, target, allowMissing });
  }

  private async wait(step: Extract<DesktopBackendStep, { type: 'wait' }>): Promise<DesktopBackendStepResult> {
    const timeoutMs = step.timeoutMs ?? this.actionTimeoutMs;
    const condition = step.condition;
    if (condition.kind === 'duration') {
      if (condition.ms > timeoutMs) return failed('WAIT_TIMEOUT', `Duration wait exceeded its ${timeoutMs}ms timeout`);
      await new Promise((resolve) => setTimeout(resolve, condition.ms));
      return passed();
    }
    if (condition.kind !== 'visible' && condition.kind !== 'hidden' && condition.kind !== 'text') {
      return failed('UNSUPPORTED_WAIT', `Windows UI Automation does not support wait condition ${condition.kind}`);
    }
    if (condition.kind === 'text' && !condition.target) {
      return failed('UNSUPPORTED_WAIT', 'Windows UI Automation text waits require a semantic target');
    }
    const target = condition.target!;
    const started = Date.now();
    do {
      const response = await this.inspect(target, condition.kind === 'hidden');
      if (!response.ok) {
        if (response.error?.code !== 'TARGET_NOT_FOUND' || condition.kind !== 'hidden') return helperFailure(response);
      } else {
        const element = response.element;
        if (condition.kind === 'visible' && element?.exists && element.visible) return passed();
        if (condition.kind === 'hidden' && (!element?.exists || !element.visible)) return passed();
        if (condition.kind === 'text' && element?.exists && (element.name ?? '').includes(condition.value)) return passed();
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, timeoutMs)));
    } while (Date.now() - started < timeoutMs);
    return failed('WAIT_TIMEOUT', `Windows UI Automation ${condition.kind} wait exceeded ${timeoutMs}ms`);
  }

  private async assert(step: Extract<DesktopBackendStep, { type: 'assert' }>): Promise<DesktopBackendStepResult> {
    const assertion = step.assertion;
    if (assertion.kind !== 'visible' && assertion.kind !== 'hidden' && assertion.kind !== 'textContains') {
      return failed('UNSUPPORTED_ASSERTION', `Windows UI Automation does not support assertion ${assertion.kind}`);
    }
    if (assertion.kind === 'textContains' && !assertion.target) {
      return failed('UNSUPPORTED_ASSERTION', 'Windows UI Automation text assertions require a semantic target');
    }
    const response = await this.inspect(assertion.target!, assertion.kind === 'hidden');
    if (!response.ok) {
      if (assertion.kind === 'hidden' && response.error?.code === 'TARGET_NOT_FOUND') return passed();
      return helperFailure(response);
    }
    const element = response.element;
    if (assertion.kind === 'visible') {
      return element?.exists && element.visible ? passed() : failed('ASSERTION_FAILED', 'Expected target to be visible');
    }
    if (assertion.kind === 'hidden') {
      return !element?.exists || !element.visible ? passed() : failed('ASSERTION_FAILED', 'Expected target to be hidden');
    }
    return (element?.name ?? '').includes(assertion.value)
      ? passed()
      : failed('ASSERTION_FAILED', `Expected target text to contain ${JSON.stringify(assertion.value)}`);
  }
}
