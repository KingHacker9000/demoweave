import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  EvidenceSchema,
  ManifestSchema,
  normalizeManifest,
  type Evidence,
  type EvidenceFormat,
  type Manifest,
} from '@demoweave/core';
import type { DriverContext, DriverDescriptor, DriverStepResult, SurfaceDriver } from './index.js';
import {
  ProcessTerminalSession,
  type TerminalSession,
  type TerminalSessionResult,
} from './terminal-session.js';

export const researchDriverVersion = '0.0.1';

export interface ResearchDriverOptions {
  commandTimeoutMs?: number;
  waitTimeoutMs?: number;
  flowPath?: string;
  sessionFactory?: () => TerminalSession;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;

const formatByExtension: Record<string, { format: EvidenceFormat; mimeType: string }> = {
  '.png': { format: 'png', mimeType: 'image/png' },
  '.jpg': { format: 'jpeg', mimeType: 'image/jpeg' },
  '.jpeg': { format: 'jpeg', mimeType: 'image/jpeg' },
  '.webp': { format: 'webp', mimeType: 'image/webp' },
  '.gif': { format: 'gif', mimeType: 'image/gif' },
  '.webm': { format: 'webm', mimeType: 'video/webm' },
  '.mp4': { format: 'mp4', mimeType: 'video/mp4' },
  '.svg': { format: 'svg', mimeType: 'image/svg+xml' },
  '.json': { format: 'json', mimeType: 'application/json' },
  '.csv': { format: 'csv', mimeType: 'text/csv' },
  '.txt': { format: 'txt', mimeType: 'text/plain' },
  '.md': { format: 'md', mimeType: 'text/markdown' },
  '.html': { format: 'html', mimeType: 'text/html' },
  '.ipynb': { format: 'ipynb', mimeType: 'application/x-ipynb+json' },
};

type LastRun = TerminalSessionResult;

function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function portablePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!insideRoot(root, target)) throw new Error(`Path is outside the project: ${target}`);
  return (relative || '.').split(path.sep).join('/');
}

function unsafePortablePath(value: string): boolean {
  const portable = value.replaceAll('\\', '/');
  return !portable
    || path.isAbsolute(value)
    || /^[A-Za-z]:\//.test(portable)
    || portable.startsWith('//')
    || portable.split('/').some((part) => part === '..');
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveProjectPath(root: string, relative = '.'): Promise<string> {
  if (unsafePortablePath(relative)) throw new Error(`Path must be project-relative: ${relative}`);
  const target = path.resolve(root, relative.replaceAll('\\', path.sep));
  if (!insideRoot(root, target)) throw new Error(`Path escapes the project root: ${relative}`);
  return target;
}

async function resolveExistingFile(root: string, relative: string): Promise<string> {
  const target = await resolveProjectPath(root, relative);
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]).catch((error) => {
    throw new Error(`Artifact does not exist: ${relative}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!insideRoot(realRoot, realTarget)) throw new Error(`Artifact resolves outside the project root: ${relative}`);
  const stat = await fs.stat(realTarget);
  if (!stat.isFile()) throw new Error(`Artifact is not a file: ${relative}`);
  return realTarget;
}

async function sha256File(target: string): Promise<`sha256:${string}`> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(target);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return `sha256:${hash.digest('hex')}`;
}

async function copyFileAtomic(source: string, target: string): Promise<void> {
  if (path.resolve(source) === path.resolve(target)) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.research.tmp`);
  try {
    await fs.copyFile(source, temporary);
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
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.research.tmp`);
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

export class ResearchDriver implements SurfaceDriver {
  readonly descriptor: DriverDescriptor = {
    id: 'research',
    apiVersion: 1 as const,
    surfaceTypes: ['research', 'notebook'],
    stepTypes: ['run', 'wait', 'assert', 'capture'],
  };

  private readonly commandTimeoutMs: number;
  private readonly waitTimeoutMs: number;
  private readonly flowPath?: string;
  private readonly sessionFactory: () => TerminalSession;
  private session?: TerminalSession;
  private lastRun?: LastRun;

  constructor(options: ResearchDriverOptions = {}) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.flowPath = options.flowPath;
    this.sessionFactory = options.sessionFactory ?? (() => new ProcessTerminalSession());
  }

  supports(surface: DriverContext['surface']): boolean {
    return surface.type === 'research' || surface.type === 'notebook';
  }

  async prepare(context: DriverContext): Promise<void> {
    if (!this.supports(context.surface)) throw new Error(`Research driver does not support surface type ${context.surface.type}`);
    this.session = this.sessionFactory();
    this.lastRun = undefined;
  }

  async execute(step: DriverContext['flow']['steps'][number], context: DriverContext): Promise<DriverStepResult> {
    if (!this.session) return this.failure(step.id, 'DRIVER_NOT_PREPARED', 'Research driver has not been prepared');
    try {
      switch (step.type) {
        case 'run': return await this.run(step, context);
        case 'wait': return await this.wait(step, context);
        case 'assert': return await this.assert(step, context);
        case 'capture': return await this.capture(step, context);
        default: return this.failure(step.id, 'UNSUPPORTED_ACTION', `Research driver does not support Flow action ${step.type}`);
      }
    } catch (error) {
      return this.failure(step.id, 'DRIVER_ERROR', error instanceof Error ? error.message : String(error));
    }
  }

  async close(_context: DriverContext): Promise<void> {
    await this.session?.close();
    this.session = undefined;
    this.lastRun = undefined;
  }

  private async run(
    step: Extract<DriverContext['flow']['steps'][number], { type: 'run' }>,
    context: DriverContext,
  ): Promise<DriverStepResult> {
    const cwd = await resolveProjectPath(context.projectRoot, step.cwd ?? '.');
    if (!(await pathExists(cwd))) return this.failure(step.id, 'CWD_NOT_FOUND', `Command working directory does not exist: ${step.cwd ?? '.'}`);
    const result = await this.session!.run({
      command: step.command,
      args: step.args ?? [],
      cwd,
      env: step.env,
      timeoutMs: this.commandTimeoutMs,
      onOutput: () => {},
    });
    this.lastRun = result;
    if (result.spawnError) return this.failure(step.id, 'SPAWN_FAILED', result.spawnError, result);
    if (result.timedOut) return this.failure(step.id, 'COMMAND_TIMEOUT', `Command exceeded ${this.commandTimeoutMs}ms and was terminated`, result);
    if (result.signal) return this.failure(step.id, 'COMMAND_SIGNALED', `Command was terminated by signal ${result.signal}`, result);
    const expected = step.expectedExitCodes ?? [0];
    if (result.exitCode === null || !expected.includes(result.exitCode)) {
      return this.failure(step.id, result.exitCode === 0 ? 'UNEXPECTED_EXIT' : 'NONZERO_EXIT', `Command exited with code ${result.exitCode ?? 'null'}; expected one of [${expected.join(', ')}]`, result);
    }
    return { stepId: step.id, status: 'passed', stdout: result.stdout, stderr: result.stderr, ...(result.exitCode === null ? {} : { exitCode: result.exitCode }) };
  }

  private async wait(
    step: Extract<DriverContext['flow']['steps'][number], { type: 'wait' }>,
    context: DriverContext,
  ): Promise<DriverStepResult> {
    const timeoutMs = step.timeoutMs ?? this.waitTimeoutMs;
    if (step.condition.kind === 'processExit') {
      return this.lastRun ? { stepId: step.id, status: 'passed' } : this.failure(step.id, 'NO_COMMAND', 'No research command has been run');
    }
    if (step.condition.kind === 'duration') {
      const waitMs = step.condition.ms;
      const durationTimeoutMs = step.timeoutMs ?? Math.max(this.waitTimeoutMs, waitMs);
      if (waitMs > durationTimeoutMs) return this.failure(step.id, 'WAIT_TIMEOUT', `Duration wait exceeded its ${durationTimeoutMs}ms timeout`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return { stepId: step.id, status: 'passed' };
    }
    if (step.condition.kind === 'fileExists') {
      const target = await resolveProjectPath(context.projectRoot, step.condition.path);
      const started = Date.now();
      while (Date.now() - started <= timeoutMs) {
        if (await pathExists(target)) return { stepId: step.id, status: 'passed' };
        await new Promise((resolve) => setTimeout(resolve, Math.min(25, timeoutMs)));
      }
      return this.failure(step.id, 'WAIT_TIMEOUT', `File did not appear before timeout: ${step.condition.path}`);
    }
    return this.failure(step.id, 'UNSUPPORTED_WAIT', `Research driver does not support wait condition ${step.condition.kind}`);
  }

  private async assert(
    step: Extract<DriverContext['flow']['steps'][number], { type: 'assert' }>,
    context: DriverContext,
  ): Promise<DriverStepResult> {
    if (step.assertion.kind === 'fileExists') {
      const target = await resolveProjectPath(context.projectRoot, step.assertion.path);
      return await pathExists(target)
        ? { stepId: step.id, status: 'passed' }
        : this.failure(step.id, 'ASSERTION_FAILED', `Expected file to exist: ${step.assertion.path}`);
    }
    if (!this.lastRun) return this.failure(step.id, 'NO_COMMAND', 'No research command output is available to assert');
    if (step.assertion.kind === 'exitCode') {
      return this.lastRun.exitCode === step.assertion.value
        ? { stepId: step.id, status: 'passed', ...(this.lastRun.exitCode === null ? {} : { exitCode: this.lastRun.exitCode }) }
        : this.failure(step.id, 'ASSERTION_FAILED', `Expected exit code ${step.assertion.value}, received ${this.lastRun.exitCode ?? 'null'}`, this.lastRun);
    }
    if (step.assertion.kind === 'outputContains') {
      const output = step.assertion.stream === 'stdout' ? this.lastRun.stdout : step.assertion.stream === 'stderr' ? this.lastRun.stderr : this.lastRun.combined;
      return output.includes(step.assertion.value)
        ? { stepId: step.id, status: 'passed' }
        : this.failure(step.id, 'ASSERTION_FAILED', `Expected ${step.assertion.stream} output to contain ${JSON.stringify(step.assertion.value)}`, this.lastRun);
    }
    return this.failure(step.id, 'UNSUPPORTED_ASSERTION', `Research driver does not support assertion ${step.assertion.kind}`);
  }

  private async capture(
    step: Extract<DriverContext['flow']['steps'][number], { type: 'capture' }>,
    context: DriverContext,
  ): Promise<DriverStepResult> {
    if (!step.artifact) return this.failure(step.id, 'ARTIFACT_REQUIRED', 'Research/notebook capture requires capture.artifact.path');
    if (step.target) return this.failure(step.id, 'UNSUPPORTED_CAPTURE_TARGET', 'Research/notebook capture uses artifact paths, not UI targets');
    if (step.kind === 'terminal' || step.kind === 'screenshot') return this.failure(step.id, 'UNSUPPORTED_CAPTURE', `Research driver cannot capture Evidence kind ${step.kind} from a native artifact`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(step.evidenceId)) return this.failure(step.id, 'INVALID_EVIDENCE_ID', 'Research Evidence ids must be portable filename identifiers');

    const source = await resolveExistingFile(context.projectRoot, step.artifact.path);
    const extension = path.extname(source).toLowerCase();
    const media = formatByExtension[extension];
    if (!media) return this.failure(step.id, 'UNSUPPORTED_ARTIFACT_FORMAT', `Unsupported research artifact extension: ${extension || '<none>'}`);

    const target = path.join(context.projectRoot, '.demoweave', 'evidence', 'artifacts', `${step.evidenceId}${extension}`);
    await copyFileAtomic(source, target);
    const [artifactHash, sourceHash] = await Promise.all([sha256File(target), sha256File(source)]);
    const manifest = await readManifest(context.projectRoot);
    const previous = manifest.evidence.find((item) => item.id === step.evidenceId);
    const gitCommit = currentGitCommit(context.projectRoot);
    const evidence: Evidence = EvidenceSchema.parse({
      schemaVersion: 1,
      id: step.evidenceId,
      kind: step.kind,
      status: 'available',
      ...(step.label ? { label: step.label } : previous?.label ? { label: previous.label } : {}),
      format: media.format,
      path: portablePath(context.projectRoot, target),
      artifactHash,
      mimeType: media.mimeType,
      producer: { kind: 'driver', id: 'research', version: researchDriverVersion },
      provenance: {
        flowId: context.flow.id,
        stepId: step.id,
        surfaceId: context.surface.id,
        ...(gitCommit ? { gitCommit } : {}),
        sources: [{ path: step.artifact.path.replaceAll('\\', '/'), role: 'asset', hash: sourceHash }],
      },
    });
    await writeManifest(context.projectRoot, {
      ...manifest,
      evidence: [...manifest.evidence.filter((item) => item.id !== step.evidenceId), evidence],
    });
    return { stepId: step.id, status: 'passed', evidence: [evidence] };
  }

  private failure(stepId: string, code: string, message: string, result?: TerminalSessionResult): DriverStepResult {
    return {
      stepId,
      status: 'failed',
      ...(result?.stdout ? { stdout: result.stdout } : {}),
      ...(result?.stderr ? { stderr: result.stderr } : {}),
      ...(result?.exitCode === null || result?.exitCode === undefined ? {} : { exitCode: result.exitCode }),
      error: { code, message },
    };
  }
}
