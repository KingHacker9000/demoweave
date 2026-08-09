import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import crossSpawn from 'cross-spawn';

export type TerminalOutputStream = 'stdout' | 'stderr';

export interface TerminalSessionRunOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  onOutput(stream: TerminalOutputStream, data: string): void;
}

export interface TerminalSessionResult {
  stdout: string;
  stderr: string;
  combined: string;
  exitCode: number | null;
  signal?: string;
  durationMs: number;
  timedOut: boolean;
  spawnError?: string;
}

export interface TerminalSession {
  readonly mode: 'pipe';
  run(options: TerminalSessionRunOptions): Promise<TerminalSessionResult>;
  close(): Promise<void>;
}

function mergedEnvironment(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  if (!overrides) return { ...process.env };
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (process.platform === 'win32') {
      const existing = Object.keys(environment).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (existing && existing !== key) delete environment[existing];
    }
    environment[key] = value;
  }
  return environment;
}

function terminateProcess(child: ChildProcess, force = false): void {
  if (child.exitCode !== null || child.killed) return;
  if (child.pid === undefined) {
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
    return;
  }
  if (process.platform === 'win32') {
    const args = ['/pid', String(child.pid), '/t', ...(force ? ['/f'] : [])];
    const killer = nodeSpawn('taskkill.exe', args, { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => child.kill(force ? 'SIGKILL' : 'SIGTERM'));
    return;
  }

  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
  }
}

export class ProcessTerminalSession implements TerminalSession {
  readonly mode = 'pipe' as const;
  private currentChild?: ChildProcess;
  private currentRun?: Promise<TerminalSessionResult>;

  async run(options: TerminalSessionRunOptions): Promise<TerminalSessionResult> {
    if (this.currentChild) throw new Error('A terminal command is already running');

    const started = performance.now();
    const chunks: Array<{ stream: TerminalOutputStream; data: string }> = [];
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError: string | undefined;

    const child = crossSpawn(options.command, options.args, {
      cwd: options.cwd,
      env: mergedEnvironment(options.env),
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.currentChild = child;
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    if (!stdoutStream || !stderrStream) {
      terminateProcess(child, true);
      this.currentChild = undefined;
      throw new Error('Terminal process did not expose stdout and stderr pipes');
    }
    stdoutStream.setEncoding('utf8');
    stderrStream.setEncoding('utf8');

    stdoutStream.on('data', (data: string) => {
      stdout += data;
      chunks.push({ stream: 'stdout', data });
      options.onOutput('stdout', data);
    });
    stderrStream.on('data', (data: string) => {
      stderr += data;
      chunks.push({ stream: 'stderr', data });
      options.onOutput('stderr', data);
    });
    child.on('error', (error) => {
      spawnError = error.message;
    });

    let forceTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcess(child);
      forceTimer = setTimeout(() => terminateProcess(child, true), 500);
      forceTimer.unref();
    }, options.timeoutMs);
    timeout.unref();

    this.currentRun = new Promise<TerminalSessionResult>((resolve) => {
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        if (forceTimer) clearTimeout(forceTimer);
        const result: TerminalSessionResult = {
          stdout,
          stderr,
          combined: chunks.map((chunk) => chunk.data).join(''),
          exitCode: code,
          ...(signal ? { signal } : {}),
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          timedOut,
          ...(spawnError ? { spawnError } : {}),
        };
        this.currentChild = undefined;
        this.currentRun = undefined;
        resolve(result);
      });
    });

    return this.currentRun;
  }

  async close(): Promise<void> {
    if (!this.currentChild || !this.currentRun) return;
    terminateProcess(this.currentChild);
    await this.currentRun;
  }
}
