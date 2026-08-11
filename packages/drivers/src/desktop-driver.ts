import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  EvidenceSchema,
  ManifestSchema,
  normalizeManifest,
  type Evidence,
  type Manifest,
} from '@demoweave/core';
import type { DriverContext, DriverDescriptor, DriverStepResult, SurfaceDriver } from './index.js';
import type {
  DesktopBackend,
  DesktopBackendProbe,
  DesktopBackendStep,
  DesktopPngCapture,
} from './desktop-backend.js';
import {
  getDesktopHostCapabilities,
  type DesktopHostCapabilities,
} from './desktop-capabilities.js';

export const desktopDriverVersion = '0.0.1';

export interface DesktopDriverOptions {
  backends?: DesktopBackend[];
  hostCapabilities?: DesktopHostCapabilities;
  flowPath?: string;
}

type ProbeAttempt = {
  backendId: string;
  probe: DesktopBackendProbe;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function portablePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Desktop artifact path escapes the project root: ${target}`);
  }
  return (relative || '.').replaceAll(path.sep, '/');
}

async function writeFileAtomic(target: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.desktop.tmp`);
  try {
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function readManifest(projectRoot: string): Promise<Manifest> {
  const manifestPath = path.join(projectRoot, '.demoweave', 'evidence', 'manifest.json');
  if (!(await pathExists(manifestPath))) {
    return ManifestSchema.parse({ schemaVersion: 1, projectProfileVersion: 1, flows: [], evidence: [] });
  }
  return ManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
}

async function writeManifest(projectRoot: string, manifest: Manifest): Promise<void> {
  const target = path.join(projectRoot, '.demoweave', 'evidence', 'manifest.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.desktop.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`, 'utf8');
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
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

function validatePng(capture: DesktopPngCapture): Buffer {
  const bytes = Buffer.from(capture.bytes);
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Desktop backend capture is not a valid PNG byte stream');
  }
  return bytes;
}

function isDesktopStep(step: DriverContext['flow']['steps'][number]): step is DesktopBackendStep {
  return ['activate', 'input', 'press', 'scroll', 'wait', 'assert', 'capture'].includes(step.type);
}

export class DesktopDriver implements SurfaceDriver {
  readonly descriptor: DriverDescriptor = {
    id: 'desktop',
    apiVersion: 1 as const,
    surfaceTypes: ['desktop'],
    stepTypes: ['activate', 'input', 'press', 'scroll', 'wait', 'assert', 'capture'],
  };

  private readonly backends: DesktopBackend[];
  private readonly hostCapabilities: DesktopHostCapabilities;
  private readonly flowPath?: string;
  private selected?: DesktopBackend;
  private probeAttempts: ProbeAttempt[] = [];

  constructor(options: DesktopDriverOptions = {}) {
    this.backends = options.backends ?? [];
    this.hostCapabilities = options.hostCapabilities ?? getDesktopHostCapabilities();
    this.flowPath = options.flowPath;
  }

  supports(surface: DriverContext['surface']): boolean {
    return surface.type === 'desktop';
  }

  async prepare(context: DriverContext): Promise<void> {
    if (!this.supports(context.surface)) {
      throw new Error(`Desktop driver does not support surface type ${context.surface.type}`);
    }

    this.selected = undefined;
    this.probeAttempts = [];
    const candidates = this.backends.filter((backend) =>
      backend.descriptor.platforms.includes(this.hostCapabilities.platform));

    if (!candidates.length) {
      const detail = this.hostCapabilities.detail ? ` ${this.hostCapabilities.detail}` : '';
      throw new Error(
        `No desktop backend is registered for ${this.hostCapabilities.platform}.` +
        `${detail} M12 desktop foundations are present, but a native backend is still required.`,
      );
    }

    for (const backend of candidates) {
      const probe = await backend.probe(context);
      this.probeAttempts.push({ backendId: backend.descriptor.id, probe });
      if (!probe.available) continue;
      await backend.open(context);
      this.selected = backend;
      return;
    }

    const diagnostics = this.probeAttempts
      .map(({ backendId, probe }) => `${backendId}: ${probe.reason ?? probe.detail ?? 'unavailable'}`)
      .join('; ');
    throw new Error(`No registered desktop backend is available.${diagnostics ? ` ${diagnostics}` : ''}`);
  }

  async execute(step: DriverContext['flow']['steps'][number], context: DriverContext): Promise<DriverStepResult> {
    const backend = this.selected;
    if (!backend) return this.failure(step.id, 'DRIVER_NOT_PREPARED', 'Desktop driver has not selected an available backend');
    if (!isDesktopStep(step)) return this.failure(step.id, 'UNSUPPORTED_ACTION', `Desktop driver does not support Flow action ${step.type}`);
    if (!backend.descriptor.stepTypes.includes(step.type)) {
      return this.failure(
        step.id,
        'BACKEND_UNSUPPORTED_ACTION',
        `Desktop backend ${backend.descriptor.id} does not support Flow action ${step.type}`,
      );
    }

    try {
      if (step.type === 'capture') return await this.capture(step, context, backend);
      const result = await backend.execute(step, context);
      if (result.status === 'failed') {
        return this.failure(
          step.id,
          result.error?.code ?? 'BACKEND_STEP_FAILED',
          result.error?.message ?? `Desktop backend ${backend.descriptor.id} failed ${step.type}`,
        );
      }
      if (result.capture) {
        return this.failure(step.id, 'UNEXPECTED_CAPTURE', `Desktop backend ${backend.descriptor.id} returned capture bytes for non-capture step ${step.type}`);
      }
      return { stepId: step.id, status: 'passed' };
    } catch (error) {
      return this.failure(step.id, 'DESKTOP_BACKEND_ERROR', error instanceof Error ? error.message : String(error));
    }
  }

  async close(context: DriverContext): Promise<void> {
    const backend = this.selected;
    this.selected = undefined;
    if (backend) await backend.close(context);
  }

  private async capture(
    step: Extract<DesktopBackendStep, { type: 'capture' }>,
    context: DriverContext,
    backend: DesktopBackend,
  ): Promise<DriverStepResult> {
    if (step.kind !== 'screenshot') {
      return this.failure(step.id, 'UNSUPPORTED_CAPTURE', `Desktop driver currently captures screenshot Evidence, not ${step.kind}`);
    }
    if (step.artifact) {
      return this.failure(step.id, 'UNSUPPORTED_CAPTURE_SOURCE', 'Desktop screenshot capture uses a semantic target/window, not capture.artifact.path');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(step.evidenceId)) {
      return this.failure(step.id, 'INVALID_EVIDENCE_ID', 'Desktop screenshot Evidence ids must be portable filename identifiers');
    }
    const requiredCapability = step.target ? 'element-capture' : 'window-capture';
    if (!backend.descriptor.capabilities.includes(requiredCapability)) {
      return this.failure(
        step.id,
        'BACKEND_CAPTURE_UNSUPPORTED',
        `Desktop backend ${backend.descriptor.id} does not provide ${requiredCapability}`,
      );
    }

    const result = await backend.execute(step, context);
    if (result.status === 'failed') {
      return this.failure(
        step.id,
        result.error?.code ?? 'BACKEND_CAPTURE_FAILED',
        result.error?.message ?? `Desktop backend ${backend.descriptor.id} failed screenshot capture`,
      );
    }
    if (!result.capture) {
      return this.failure(step.id, 'BACKEND_CAPTURE_MISSING', `Desktop backend ${backend.descriptor.id} returned no screenshot bytes`);
    }

    const bytes = validatePng(result.capture);
    const artifactPath = path.join(
      context.projectRoot,
      '.demoweave',
      'evidence',
      'artifacts',
      `${step.evidenceId}.png`,
    );
    await writeFileAtomic(artifactPath, bytes);

    const manifest = await readManifest(context.projectRoot);
    const previous = manifest.evidence.find((item) => item.id === step.evidenceId);
    const gitCommit = currentGitCommit(context.projectRoot);
    const producerId = `desktop/${backend.descriptor.id}`;
    const evidence: Evidence = EvidenceSchema.parse({
      schemaVersion: 1,
      id: step.evidenceId,
      kind: 'screenshot',
      status: 'available',
      ...(step.label ? { label: step.label } : previous?.label ? { label: previous.label } : {}),
      format: 'png',
      path: portablePath(context.projectRoot, artifactPath),
      mimeType: 'image/png',
      producer: {
        kind: 'driver',
        id: producerId,
        version: backend.descriptor.version ?? desktopDriverVersion,
      },
      provenance: {
        flowId: context.flow.id,
        stepId: step.id,
        surfaceId: context.surface.id,
        ...(gitCommit ? { gitCommit } : {}),
        sources: [],
      },
    });
    await writeManifest(context.projectRoot, {
      ...manifest,
      evidence: [...manifest.evidence.filter((item) => item.id !== step.evidenceId), evidence],
    });
    return { stepId: step.id, status: 'passed', evidence: [evidence] };
  }

  private failure(stepId: string, code: string, message: string): DriverStepResult {
    return { stepId, status: 'failed', error: { code, message } };
  }
}
