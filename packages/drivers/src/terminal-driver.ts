import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  EvidenceSchema,
  ManifestSchema,
  TerminalTrackSchema,
  normalizeManifest,
  type Evidence,
  type Manifest,
  type TerminalCommand,
  type TerminalEvent,
  type TerminalTrack,
} from '@demoweave/core';
import type { DriverContext, DriverDescriptor, DriverStepResult, SurfaceDriver } from './index.js';
import {
  ProcessTerminalSession,
  type TerminalOutputStream,
  type TerminalSession,
  type TerminalSessionResult,
} from './terminal-session.js';

export const terminalDriverVersion = '0.0.1';

export interface TerminalDriverOptions {
  columns?: number;
  rows?: number;
  commandTimeoutMs?: number;
  flowPath?: string;
  sessionFactory?: () => TerminalSession;
}

type RecordedRun = {
  command: TerminalCommand;
  result: TerminalSessionResult;
};

const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 30;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;

function portableRelative(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!relative) return '.';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return '<outside-project>';
  }
  return relative.replaceAll(path.sep, '/');
}

function sanitizeExecutable(root: string, command: string): string {
  if (!path.isAbsolute(command)) return command;
  const relative = portableRelative(root, command);
  return relative === '<outside-project>' ? `<absolute>/${path.basename(command)}` : relative;
}

function replaceEvery(value: string, search: string, replacement: string): string {
  if (!search) return value;
  if (process.platform !== 'win32') return value.split(search).join(replacement);
  return value.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replacement);
}

function sanitizeOutput(projectRoot: string, value: string): string {
  let sanitized = replaceEvery(value, projectRoot, '.');
  sanitized = replaceEvery(sanitized, projectRoot.replaceAll('\\', '/'), '.');
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home && path.resolve(home) !== path.resolve(projectRoot)) {
    sanitized = replaceEvery(sanitized, home, '<home>');
    sanitized = replaceEvery(sanitized, home.replaceAll('\\', '/'), '<home>');
  }
  return sanitized;
}

function quoteDisplayArgument(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
}

function displayCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteDisplayArgument).join(' ');
}

function resolveFromProject(projectRoot: string, input = '.'): string {
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(projectRoot, input);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
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

function commandStatus(result: TerminalSessionResult): TerminalCommand['status'] {
  if (result.spawnError) return 'spawnFailed';
  if (result.timedOut) return 'timedOut';
  if (result.signal) return 'signaled';
  return 'completed';
}

export class TerminalDriver implements SurfaceDriver {
  readonly descriptor: DriverDescriptor = {
    id: 'terminal',
    apiVersion: 1 as const,
    surfaceTypes: ['terminal'],
    stepTypes: ['run', 'wait', 'assert', 'capture'],
  };

  private readonly columns: number;
  private readonly rows: number;
  private readonly commandTimeoutMs: number;
  private readonly flowPath?: string;
  private readonly sessionFactory: () => TerminalSession;
  private session?: TerminalSession;
  private trackStarted?: number;
  private events: TerminalEvent[] = [];
  private runs: RecordedRun[] = [];

  constructor(options: TerminalDriverOptions = {}) {
    this.columns = options.columns ?? DEFAULT_COLUMNS;
    this.rows = options.rows ?? DEFAULT_ROWS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.flowPath = options.flowPath;
    this.sessionFactory = options.sessionFactory ?? (() => new ProcessTerminalSession());
  }

  supports(surface: DriverContext['surface']): boolean {
    return surface.type === 'terminal';
  }

  async prepare(context: DriverContext): Promise<void> {
    if (!this.supports(context.surface)) {
      throw new Error(`Terminal driver does not support surface type ${context.surface.type}`);
    }
    this.session = this.sessionFactory();
    this.trackStarted = undefined;
    this.events = [];
    this.runs = [];
  }

  async execute(step: DriverContext['flow']['steps'][number], context: DriverContext): Promise<DriverStepResult> {
    if (!this.session) {
      return this.failure(step.id, 'DRIVER_NOT_PREPARED', 'Terminal driver has not been prepared');
    }

    try {
      switch (step.type) {
        case 'run':
          return await this.run(step, context);
        case 'wait':
          return await this.wait(step, context);
        case 'assert':
          return await this.assert(step, context);
        case 'capture':
          return await this.capture(step, context);
        default:
          return this.failure(step.id, 'UNSUPPORTED_ACTION', `Terminal driver does not support Flow action ${step.type}`);
      }
    } catch (error) {
      return this.failure(
        step.id,
        'DRIVER_ERROR',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async close(): Promise<void> {
    await this.session?.close();
    this.session = undefined;
  }

  private elapsed(): number {
    return this.trackStarted === undefined ? 0 : Math.max(0, Math.round(performance.now() - this.trackStarted));
  }

  private recordEvent(stepId: string, stream: TerminalEvent['stream'], data: string): void {
    const previous = this.events.at(-1)?.t ?? 0;
    this.events.push({
      sequence: this.events.length,
      t: Math.max(previous, this.elapsed()),
      stepId,
      stream,
      data,
    });
  }

  private async run(
    step: Extract<DriverContext['flow']['steps'][number], { type: 'run' }>,
    context: DriverContext,
  ): Promise<DriverStepResult> {
    const cwd = resolveFromProject(context.projectRoot, step.cwd);
    if (!(await pathExists(cwd))) {
      return this.failure(step.id, 'CWD_NOT_FOUND', `Command working directory does not exist: ${step.cwd ?? '.'}`);
    }

    if (this.trackStarted === undefined) this.trackStarted = performance.now();
    const startedAt = this.elapsed();
    const args = step.args ?? [];
    const portableCommand = sanitizeExecutable(context.projectRoot, step.command);
    const portableArgs = args.map((argument) => sanitizeOutput(context.projectRoot, argument));
    this.recordEvent(step.id, 'input', `${displayCommand(portableCommand, portableArgs)}\n`);

    const result = await this.session!.run({
      command: step.command,
      args,
      cwd,
      env: step.env,
      timeoutMs: this.commandTimeoutMs,
      onOutput: (stream: TerminalOutputStream, data: string) => {
        this.recordEvent(step.id, stream, sanitizeOutput(context.projectRoot, data));
      },
    });
    const command: TerminalCommand = {
      stepId: step.id,
      command: portableCommand,
      args: portableArgs,
      cwd: portableRelative(context.projectRoot, cwd),
      startedAt,
      durationMs: result.durationMs,
      status: commandStatus(result),
      exitCode: result.exitCode,
      ...(result.signal ? { signal: result.signal } : {}),
    };
    this.runs.push({ command, result });

    if (result.spawnError) {
      return this.failure(step.id, 'SPAWN_FAILED', result.spawnError, result);
    }
    if (result.timedOut) {
      return this.failure(step.id, 'COMMAND_TIMEOUT', `Command exceeded ${this.commandTimeoutMs}ms and was terminated`, result);
    }
    if (result.signal) {
      return this.failure(step.id, 'COMMAND_SIGNALED', `Command was terminated by signal ${result.signal}`, result);
    }
    const expectedExitCodes = step.expectedExitCodes ?? [0];
    if (result.exitCode === null || !expectedExitCodes.includes(result.exitCode)) {
      const code = result.exitCode === 0 ? 'UNEXPECTED_EXIT' : 'NONZERO_EXIT';
      return this.failure(
        step.id,
        code,
        `Command exited with code ${result.exitCode ?? 'null'}; expected one of [${expectedExitCodes.join(', ')}]`,
        result,
      );
    }
    return {
      stepId: step.id,
      status: 'passed',
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  private async wait(
    step: Extract<DriverContext['flow']['steps'][number], { type: 'wait' }>,
    context: DriverContext,
  ): Promise<DriverStepResult> {
    const timeoutMs = step.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    if (step.condition.kind === 'processExit') {
      return this.runs.length
        ? { stepId: step.id, status: 'passed' }
        : this.failure(step.id, 'NO_COMMAND', 'No terminal command has been run');
    }
    if (step.condition.kind === 'duration') {
      const durationTimeoutMs = step.timeoutMs ?? Math.max(DEFAULT_WAIT_TIMEOUT_MS, step.condition.ms);
      const waitMs = Math.min(step.condition.ms, durationTimeoutMs);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return step.condition.ms <= durationTimeoutMs
        ? { stepId: step.id, status: 'passed' }
        : this.failure(step.id, 'WAIT_TIMEOUT', `Duration wait exceeded its ${durationTimeoutMs}ms timeout`);
    }
    if (step.condition.kind === 'fileExists') {
      const target = resolveFromProject(context.projectRoot, step.condition.path);
      const started = performance.now();
      while (performance.now() - started <= timeoutMs) {
        if (await pathExists(target)) return { stepId: step.id, status: 'passed' };
        await new Promise((resolve) => setTimeout(resolve, Math.min(25, timeoutMs)));
      }
      return this.failure(step.id, 'WAIT_TIMEOUT', `File did not appear before timeout: ${step.condition.path}`);
    }
    return this.failure(step.id, 'UNSUPPORTED_WAIT', `Terminal driver does not support wait condition ${step.condition.kind}`);
  }

  private async assert(
    step: Extract<DriverContext['flow']['steps'][number], { type: 'assert' }>,
    context: DriverContext,
  ): Promise<DriverStepResult> {
    if (step.assertion.kind === 'fileExists') {
      const found = await pathExists(resolveFromProject(context.projectRoot, step.assertion.path));
      return found
        ? { stepId: step.id, status: 'passed' }
        : this.failure(step.id, 'ASSERTION_FAILED', `Expected file to exist: ${step.assertion.path}`);
    }

    const last = this.runs.at(-1)?.result;
    if (!last) return this.failure(step.id, 'NO_COMMAND', 'No terminal command output is available to assert');

    if (step.assertion.kind === 'exitCode') {
      return last.exitCode === step.assertion.value
        ? { stepId: step.id, status: 'passed', ...(last.exitCode === null ? {} : { exitCode: last.exitCode }) }
        : this.failure(
          step.id,
          'ASSERTION_FAILED',
          `Expected exit code ${step.assertion.value}, received ${last.exitCode ?? 'null'}`,
          last,
        );
    }
    if (step.assertion.kind === 'outputContains') {
      const output = step.assertion.stream === 'stdout'
        ? last.stdout
        : step.assertion.stream === 'stderr'
          ? last.stderr
          : last.combined;
      return output.includes(step.assertion.value)
        ? { stepId: step.id, status: 'passed' }
        : this.failure(
          step.id,
          'ASSERTION_FAILED',
          `Expected ${step.assertion.stream} output to contain ${JSON.stringify(step.assertion.value)}`,
          last,
        );
    }
    return this.failure(step.id, 'UNSUPPORTED_ASSERTION', `Terminal driver does not support assertion ${step.assertion.kind}`);
  }

  private async capture(
    step: Extract<DriverContext['flow']['steps'][number], { type: 'capture' }>,
    context: DriverContext,
  ): Promise<DriverStepResult> {
    if (step.kind !== 'terminal') {
      return this.failure(step.id, 'UNSUPPORTED_CAPTURE', `Terminal driver cannot capture Evidence kind ${step.kind}`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(step.evidenceId)) {
      return this.failure(step.id, 'INVALID_EVIDENCE_ID', 'Terminal Evidence ids must be portable filename identifiers');
    }
    if (!this.runs.length) {
      return this.failure(step.id, 'NO_COMMAND', 'Terminal capture requires at least one completed run step');
    }

    const finalRun = this.runs.at(-1)!;
    const durationMs = Math.max(...this.runs.map(({ command }) => command.startedAt + command.durationMs));
    const track: TerminalTrack = TerminalTrackSchema.parse({
      schemaVersion: 1,
      columns: this.columns,
      rows: this.rows,
      mode: this.session!.mode,
      commands: this.runs.map(({ command }) => command),
      events: this.events,
      status: finalRun.command.status,
      exitCode: finalRun.command.exitCode,
      durationMs,
    });

    const artifactPath = path.join(
      context.projectRoot,
      '.demoweave',
      'evidence',
      'artifacts',
      `${step.evidenceId}.terminal.json`,
    );
    await writeJsonAtomic(artifactPath, track);

    const manifest = await readManifest(context.projectRoot);
    const previous = manifest.evidence.find((item) => item.id === step.evidenceId);
    const gitCommit = currentGitCommit(context.projectRoot);
    const evidence: Evidence = EvidenceSchema.parse({
      schemaVersion: 1,
      id: step.evidenceId,
      kind: 'terminal',
      status: 'available',
      ...(previous?.label ? { label: previous.label } : {}),
      format: 'json',
      path: portableRelative(context.projectRoot, artifactPath),
      mimeType: 'application/vnd.demoweave.terminal+json',
      producer: { kind: 'driver', id: 'terminal', version: terminalDriverVersion },
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

  private failure(
    stepId: string,
    code: string,
    message: string,
    result?: TerminalSessionResult,
  ): DriverStepResult {
    return {
      stepId,
      status: 'failed',
      ...(result?.stdout !== undefined ? { stdout: result.stdout } : {}),
      ...(result?.stderr !== undefined ? { stderr: result.stderr } : {}),
      ...(result?.exitCode === null || result?.exitCode === undefined ? {} : { exitCode: result.exitCode }),
      error: { code, message },
    };
  }
}
