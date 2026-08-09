import { spawn } from 'node:child_process';

export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type ProcessRunner = (executable: string, args: string[]) => Promise<ProcessResult>;

export class RendererError extends Error {
  constructor(public readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RendererError';
  }
}

export const runProcess: ProcessRunner = (executable, args) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    if (stdout.length > 16_000) stdout = stdout.slice(-16_000);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
  });
  child.once('error', reject);
  child.once('close', (exitCode) => resolve({ exitCode, stdout: stdout.trim(), stderr: stderr.trim() }));
});

export async function ffmpegVersion(ffmpegPath = 'ffmpeg', runner: ProcessRunner = runProcess): Promise<string | undefined> {
  try {
    const result = await runner(ffmpegPath, ['-version']);
    if (result.exitCode !== 0) return undefined;
    return (result.stdout || result.stderr).split(/\r?\n/, 1)[0] || 'available';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    return undefined;
  }
}

export async function encodeGif(
  framePattern: string,
  palettePath: string,
  outputPath: string,
  framesPerSecond: number,
  ffmpegPath = 'ffmpeg',
  runner: ProcessRunner = runProcess,
): Promise<void> {
  if (!(await ffmpegVersion(ffmpegPath, runner))) {
    throw new RendererError('FFMPEG_NOT_FOUND', 'FFmpeg is required for GIF rendering. Install FFmpeg and ensure `ffmpeg` is available on PATH. PNG rendering remains available without it.');
  }

  const commonInput = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(framesPerSecond), '-start_number', '0', '-i', framePattern];
  const palette = await runner(ffmpegPath, [
    ...commonInput,
    '-vf', 'palettegen=stats_mode=diff:max_colors=256',
    palettePath,
  ]).catch((error) => {
    throw new RendererError('FFMPEG_FAILED', `FFmpeg palette generation could not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  });
  if (palette.exitCode !== 0) {
    throw new RendererError('FFMPEG_FAILED', `FFmpeg palette generation failed (exit ${palette.exitCode ?? 'unknown'}): ${palette.stderr || 'no diagnostic output'}`);
  }

  const encoded = await runner(ffmpegPath, [
    ...commonInput,
    '-i', palettePath,
    '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-loop', '0',
    outputPath,
  ]).catch((error) => {
    throw new RendererError('FFMPEG_FAILED', `FFmpeg GIF encoding could not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  });
  if (encoded.exitCode !== 0) {
    throw new RendererError('FFMPEG_FAILED', `FFmpeg GIF encoding failed (exit ${encoded.exitCode ?? 'unknown'}): ${encoded.stderr || 'no diagnostic output'}`);
  }
}
