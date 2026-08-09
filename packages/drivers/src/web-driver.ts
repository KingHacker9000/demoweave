import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  EvidenceSchema,
  ManifestSchema,
  normalizeManifest,
  type Evidence,
  type InteractionTarget,
  type Manifest,
} from '@demoweave/core';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import type { DriverContext, DriverDescriptor, DriverStepResult, SurfaceDriver } from './index.js';

export const webDriverVersion = '0.0.1';

export interface WebDriverOptions {
  baseUrl?: string;
  headless?: boolean;
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
  viewport?: { width: number; height: number };
  flowPath?: string;
}

const DEFAULT_ACTION_TIMEOUT_MS = 5_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;
const DEFAULT_SCROLL_AMOUNT = 600;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;

function portableRelative(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!relative) return '.';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return '<outside-project>';
  }
  return relative.replaceAll(path.sep, '/');
}

function sanitizeMessage(projectRoot: string, value: string): string {
  let output = value.split(projectRoot).join('.');
  output = output.split(projectRoot.replaceAll('\\', '/')).join('.');
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home && path.resolve(home) !== path.resolve(projectRoot)) {
    output = output.split(home).join('<home>');
    output = output.split(home.replaceAll('\\', '/')).join('<home>');
  }
  return output;
}

function currentGitCommit(projectRoot: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  const commit = result.status === 0 ? result.stdout.trim() : '';
  return /^[0-9a-f]{40}$/i.test(commit) ? commit : undefined;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(projectRoot: string): Promise<Manifest> {
  const manifestPath = path.join(projectRoot, '.demoweave', 'evidence', 'manifest.json');
  if (!(await pathExists(manifestPath))) {
    return ManifestSchema.parse({
      schemaVersion: 1,
      projectProfileVersion: 1,
      flows: [],
      evidence: [],
    });
  }
  return ManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function writeBufferAtomic(target: string, value: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, value);
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function quotedAttribute(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Web base URL must use http or https: ${value}`);
  }
  return url.toString();
}

function resolveDestination(destination: string, baseUrl: string | undefined): string {
  let resolved: URL;
  try {
    resolved = new URL(destination);
  } catch {
    if (!baseUrl) throw new Error(`Relative web destination requires --base-url: ${destination}`);
    resolved = new URL(destination, baseUrl);
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    throw new Error(`Web navigation only supports http or https destinations: ${destination}`);
  }
  return resolved.toString();
}

function scrollDelta(direction: 'up' | 'down' | 'left' | 'right', amount = DEFAULT_SCROLL_AMOUNT): { dx: number; dy: number } {
  switch (direction) {
    case 'up': return { dx: 0, dy: -amount };
    case 'down': return { dx: 0, dy: amount };
    case 'left': return { dx: -amount, dy: 0 };
    case 'right': return { dx: amount, dy: 0 };
  }
}

export class WebDriver implements SurfaceDriver {
  readonly descriptor: DriverDescriptor = {
    id: 'web',
    apiVersion: 1 as const,
    surfaceTypes: ['web'],
    stepTypes: ['navigate', 'activate', 'input', 'press', 'scroll', 'wait', 'assert', 'capture'],
  };

  private readonly baseUrl?: string;
  private readonly headless: boolean;
  private readonly actionTimeoutMs: number;
  private readonly navigationTimeoutMs: number;
  private readonly viewport: { width: number; height: number };
  private readonly flowPath?: string;
  private browser?: Browser;
  private browserContext?: BrowserContext;
  private page?: Page;

  constructor(options: WebDriverOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.headless = options.headless ?? true;
    this.actionTimeoutMs = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
    this.viewport = options.viewport ?? DEFAULT_VIEWPORT;
    this.flowPath = options.flowPath;
  }

  supports(surface: DriverContext['surface']): boolean {
    return surface.type === 'web';
  }

  async prepare(context: DriverContext): Promise<void> {
    if (!this.supports(context.surface)) {
      throw new Error(`Web driver does not support surface type ${context.surface.type}`);
    }
    this.browser = await chromium.launch({ headless: this.headless });
    this.browserContext = await this.browser.newContext({
      viewport: this.viewport,
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    this.page = await this.browserContext.newPage();
    this.page.setDefaultTimeout(this.actionTimeoutMs);
    this.page.setDefaultNavigationTimeout(this.navigationTimeoutMs);
  }

  async execute(step: DriverContext['flow']['steps'][number], context: DriverContext): Promise<DriverStepResult> {
    if (!this.page) return this.failure(step.id, 'DRIVER_NOT_PREPARED', 'Web driver has not been prepared');
    try {
      switch (step.type) {
        case 'navigate': return await this.navigate(step);
        case 'activate': return await this.activate(step);
        case 'input': return await this.input(step);
        case 'press': return await this.press(step);
        case 'scroll': return await this.scroll(step);
        case 'wait': return await this.wait(step);
        case 'assert': return await this.assert(step);
        case 'capture': return await this.capture(step, context);
        default: return this.failure(step.id, 'UNSUPPORTED_ACTION', `Web driver does not support Flow action ${step.type}`);
      }
    } catch (error) {
      return this.failure(
        step.id,
        'DRIVER_ERROR',
        sanitizeMessage(context.projectRoot, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  async close(): Promise<void> {
    try {
      await this.browserContext?.close();
    } finally {
      await this.browser?.close();
      this.page = undefined;
      this.browserContext = undefined;
      this.browser = undefined;
    }
  }

  private target(target: InteractionTarget): Locator {
    const page = this.page!;
    switch (target.strategy) {
      case 'text':
        return page.getByText(target.value, { exact: target.exact });
      case 'label':
        return page.getByLabel(target.value, { exact: target.exact });
      case 'role':
        return page.getByRole(target.value as Parameters<Page['getByRole']>[0]);
      case 'name':
        return page.locator(`[name=${quotedAttribute(target.value)}]`);
      case 'testId':
        return page.getByTestId(target.value);
      case 'accessibilityId':
        return page.locator(`[aria-label=${quotedAttribute(target.value)}]`);
      case 'automationId':
        return page.locator(`[data-automation-id=${quotedAttribute(target.value)}]`);
    }
  }

  private async navigate(step: Extract<DriverContext['flow']['steps'][number], { type: 'navigate' }>): Promise<DriverStepResult> {
    const response = await this.page!.goto(resolveDestination(step.destination, this.baseUrl), { waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 400) {
      return this.failure(step.id, 'NAVIGATION_HTTP_ERROR', `Navigation returned HTTP ${response.status()}: ${response.url()}`);
    }
    return { stepId: step.id, status: 'passed' };
  }

  private async activate(step: Extract<DriverContext['flow']['steps'][number], { type: 'activate' }>): Promise<DriverStepResult> {
    await this.target(step.target).click();
    return { stepId: step.id, status: 'passed' };
  }

  private async input(step: Extract<DriverContext['flow']['steps'][number], { type: 'input' }>): Promise<DriverStepResult> {
    const target = this.target(step.target);
    if (step.clear) await target.fill(step.value);
    else await target.pressSequentially(step.value);
    return { stepId: step.id, status: 'passed' };
  }

  private async press(step: Extract<DriverContext['flow']['steps'][number], { type: 'press' }>): Promise<DriverStepResult> {
    if (step.target) await this.target(step.target).press(step.key);
    else await this.page!.keyboard.press(step.key);
    return { stepId: step.id, status: 'passed' };
  }

  private async scroll(step: Extract<DriverContext['flow']['steps'][number], { type: 'scroll' }>): Promise<DriverStepResult> {
    const delta = scrollDelta(step.direction, step.amount);
    if (step.target) {
      await this.target(step.target).evaluate((element, value) => {
        element.scrollBy(value.dx, value.dy);
      }, delta);
    } else {
      await this.page!.evaluate((value) => window.scrollBy(value.dx, value.dy), delta);
    }
    return { stepId: step.id, status: 'passed' };
  }

  private async wait(step: Extract<DriverContext['flow']['steps'][number], { type: 'wait' }>): Promise<DriverStepResult> {
    const timeout = step.timeoutMs ?? this.actionTimeoutMs;
    switch (step.condition.kind) {
      case 'duration': {
        const durationMs = step.condition.ms;
        if (durationMs > timeout) {
          await new Promise((resolve) => setTimeout(resolve, timeout));
          return this.failure(step.id, 'WAIT_TIMEOUT', `Duration wait exceeded its ${timeout}ms timeout`);
        }
        await new Promise((resolve) => setTimeout(resolve, durationMs));
        return { stepId: step.id, status: 'passed' };
      }
      case 'visible':
        await this.target(step.condition.target).waitFor({ state: 'visible', timeout });
        return { stepId: step.id, status: 'passed' };
      case 'hidden':
        await this.target(step.condition.target).waitFor({ state: 'hidden', timeout });
        return { stepId: step.id, status: 'passed' };
      case 'text': {
        const locator = step.condition.target
          ? this.target(step.condition.target).filter({ hasText: step.condition.value })
          : this.page!.getByText(step.condition.value, { exact: false }).first();
        await locator.waitFor({ state: 'visible', timeout });
        return { stepId: step.id, status: 'passed' };
      }
      default:
        return this.failure(step.id, 'UNSUPPORTED_WAIT', `Web driver does not support wait condition ${step.condition.kind}`);
    }
  }

  private async assert(step: Extract<DriverContext['flow']['steps'][number], { type: 'assert' }>): Promise<DriverStepResult> {
    switch (step.assertion.kind) {
      case 'visible': {
        const visible = await this.target(step.assertion.target).isVisible();
        return visible
          ? { stepId: step.id, status: 'passed' }
          : this.failure(step.id, 'ASSERTION_FAILED', 'Expected target to be visible');
      }
      case 'hidden': {
        const visible = await this.target(step.assertion.target).isVisible();
        return !visible
          ? { stepId: step.id, status: 'passed' }
          : this.failure(step.id, 'ASSERTION_FAILED', 'Expected target to be hidden');
      }
      case 'textContains': {
        const text = step.assertion.target
          ? await this.target(step.assertion.target).innerText()
          : await this.page!.locator('body').innerText();
        return text.includes(step.assertion.value)
          ? { stepId: step.id, status: 'passed' }
          : this.failure(step.id, 'ASSERTION_FAILED', `Expected page text to contain ${JSON.stringify(step.assertion.value)}`);
      }
      default:
        return this.failure(step.id, 'UNSUPPORTED_ASSERTION', `Web driver does not support assertion ${step.assertion.kind}`);
    }
  }

  private async capture(
    step: Extract<DriverContext['flow']['steps'][number], { type: 'capture' }>,
    context: DriverContext,
  ): Promise<DriverStepResult> {
    if (step.kind !== 'screenshot') {
      return this.failure(step.id, 'UNSUPPORTED_CAPTURE', `Web driver cannot capture Evidence kind ${step.kind}`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(step.evidenceId)) {
      return this.failure(step.id, 'INVALID_EVIDENCE_ID', 'Screenshot Evidence ids must be portable filename identifiers');
    }

    const bytes = step.target
      ? await this.target(step.target).screenshot({ animations: 'disabled', caret: 'hide', type: 'png' })
      : await this.page!.screenshot({ animations: 'disabled', caret: 'hide', type: 'png', fullPage: false });
    const artifactPath = path.join(
      context.projectRoot,
      '.demoweave',
      'evidence',
      'artifacts',
      `${step.evidenceId}.png`,
    );
    await writeBufferAtomic(artifactPath, bytes);

    const manifest = await readManifest(context.projectRoot);
    const previous = manifest.evidence.find((item) => item.id === step.evidenceId);
    const gitCommit = currentGitCommit(context.projectRoot);
    const evidence: Evidence = EvidenceSchema.parse({
      schemaVersion: 1,
      id: step.evidenceId,
      kind: 'screenshot',
      status: 'available',
      ...(previous?.label ? { label: previous.label } : {}),
      format: 'png',
      path: portableRelative(context.projectRoot, artifactPath),
      mimeType: 'image/png',
      producer: { kind: 'driver', id: 'web', version: webDriverVersion },
      provenance: {
        flowId: context.flow.id,
        stepId: step.id,
        surfaceId: context.surface.id,
        ...(gitCommit ? { gitCommit } : {}),
        sources: previous?.provenance.sources ?? [],
      },
      ...(previous?.derivedFrom ? { derivedFrom: previous.derivedFrom } : {}),
    });

    const flowPath = this.flowPath ?? manifest.flows.find((item) => item.id === context.flow.id)?.path;
    const normalized = normalizeManifest({
      ...manifest,
      flows: flowPath
        ? [
          ...manifest.flows.filter((item) => item.id !== context.flow.id),
          { id: context.flow.id, path: flowPath, surfaceId: context.surface.id },
        ]
        : manifest.flows,
      evidence: [...manifest.evidence.filter((item) => item.id !== evidence.id), evidence],
    });
    await writeJsonAtomic(path.join(context.projectRoot, '.demoweave', 'evidence', 'manifest.json'), normalized);
    return { stepId: step.id, status: 'passed', evidence: [evidence] };
  }

  private failure(stepId: string, code: string, message: string): DriverStepResult {
    return { stepId, status: 'failed', error: { code, message } };
  }
}
