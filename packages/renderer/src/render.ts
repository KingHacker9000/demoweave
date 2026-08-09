import {
  ManifestSchema,
  TerminalTrackSchema,
  normalizeManifest,
  type Evidence,
  type Manifest,
  type TerminalTrack,
} from '@demoweave/core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeGif, ffmpegVersion, RendererError, type ProcessRunner } from './ffmpeg.js';
import type {
  RenderedMedia,
  TerminalLayout,
  TerminalPresentation,
  TerminalRenderSource,
} from './model.js';
import { createTerminalPresentation, presentationFrameTimes, replayPresentation } from './presentation.js';
import { ResvgRasterizer, type Rasterizer } from './rasterizer.js';
import { createTerminalLayout, renderTerminalSvg } from './svg-renderer.js';

export const rendererVersion = '0.0.1';

export type RendererCapabilities = {
  png: true;
  gif: boolean;
  webm: false;
  mp4: false;
  ffmpegVersion?: string;
};

export type RenderTerminalTrackOptions = {
  format: 'png' | 'gif';
  outputPath: string;
  ffmpegPath?: string;
  rasterizer?: Rasterizer;
  processRunner?: ProcessRunner;
};

export type RenderEvidenceOptions = {
  projectRoot?: string;
  format: 'png' | 'gif';
  outputPath?: string;
  ffmpegPath?: string;
  rasterizer?: Rasterizer;
  processRunner?: ProcessRunner;
};

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveInsideRoot(root: string, target: string, code: string): string {
  const resolved = path.resolve(root, target);
  if (!insideRoot(root, resolved)) {
    throw new RendererError(code, `Path must remain inside the project root: ${target}`);
  }
  return resolved;
}

function repositoryPath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

async function readJson(target: string, code: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8'));
  } catch (error) {
    throw new RendererError(code, `Could not read valid JSON from ${target}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function readManifest(root: string): Promise<{ path: string; manifest: Manifest }> {
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  if (!(await pathExists(manifestPath))) {
    throw new RendererError('MANIFEST_NOT_FOUND', 'DemoWeave evidence manifest is missing. Run `demoweave init .` first.');
  }
  const result = ManifestSchema.safeParse(await readJson(manifestPath, 'INVALID_MANIFEST'));
  if (!result.success) {
    throw new RendererError('INVALID_MANIFEST', `Manifest is invalid: ${result.error.issues[0]?.message ?? 'unknown validation error'}`);
  }
  return { path: manifestPath, manifest: result.data };
}

async function loadTrack(sourcePath: string): Promise<TerminalTrack> {
  const parsed = TerminalTrackSchema.safeParse(await readJson(sourcePath, 'INVALID_TERMINAL_TRACK'));
  if (!parsed.success) {
    throw new RendererError('INVALID_TERMINAL_TRACK', `TerminalTrack v1 is invalid: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`);
  }
  return parsed.data;
}

export async function loadTerminalTrack(sourcePath: string): Promise<TerminalTrack> {
  return loadTrack(path.resolve(sourcePath));
}

async function resolveSource(
  reference: string,
  root: string,
): Promise<{ source: TerminalRenderSource; manifestPath?: string; manifest?: Manifest; evidence?: Evidence }> {
  const pathCandidate = path.isAbsolute(reference) ? reference : path.resolve(root, reference);
  if (await pathExists(pathCandidate)) {
    if (!insideRoot(root, pathCandidate)) {
      throw new RendererError('UNSAFE_SOURCE_PATH', `TerminalTrack path must remain inside the project root: ${reference}`);
    }
    return { source: { track: await loadTrack(pathCandidate), sourcePath: pathCandidate } };
  }

  const { path: manifestPath, manifest } = await readManifest(root);
  const evidence = manifest.evidence.find((item) => item.id === reference);
  if (!evidence) {
    const code = /[\\/]|\.json$/i.test(reference) ? 'SOURCE_ARTIFACT_NOT_FOUND' : 'EVIDENCE_NOT_FOUND';
    throw new RendererError(code, code === 'EVIDENCE_NOT_FOUND'
      ? `Evidence id not found in manifest: ${reference}`
      : `TerminalTrack file does not exist: ${reference}`);
  }
  if (evidence.status !== 'available' && evidence.status !== 'stale') {
    throw new RendererError('EVIDENCE_UNAVAILABLE', `Evidence ${evidence.id} has status ${evidence.status}; render requires available or stale source evidence.`);
  }
  if (evidence.kind !== 'terminal') {
    throw new RendererError('WRONG_EVIDENCE_KIND', `Evidence ${evidence.id} has kind ${evidence.kind}; terminal rendering requires kind terminal.`);
  }
  if (!evidence.path) {
    throw new RendererError('SOURCE_ARTIFACT_NOT_FOUND', `Evidence ${evidence.id} does not declare an artifact path.`);
  }
  const sourcePath = resolveInsideRoot(root, evidence.path, 'UNSAFE_SOURCE_PATH');
  if (!(await pathExists(sourcePath))) {
    throw new RendererError('SOURCE_ARTIFACT_NOT_FOUND', `Source artifact for Evidence ${evidence.id} does not exist: ${evidence.path}`);
  }
  return {
    source: { track: await loadTrack(sourcePath), sourceEvidenceId: evidence.id, sourcePath },
    manifestPath,
    manifest,
    evidence,
  };
}

async function configuredMediaDirectory(root: string): Promise<string> {
  const configPath = path.join(root, '.demoweave', 'config.json');
  if (!(await pathExists(configPath))) return resolveInsideRoot(root, 'docs-media', 'UNSAFE_MEDIA_PATH');
  const config = await readJson(configPath, 'INVALID_CONFIG');
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new RendererError('INVALID_CONFIG', 'DemoWeave config must be a JSON object.');
  }
  const schemaVersion = Reflect.get(config, 'schemaVersion');
  const mediaDir = Reflect.get(config, 'mediaDir');
  if (schemaVersion !== 1 || typeof mediaDir !== 'string' || !mediaDir.trim() || path.isAbsolute(mediaDir)) {
    throw new RendererError('INVALID_CONFIG', 'DemoWeave config requires schemaVersion 1 and a non-empty project-relative mediaDir.');
  }
  return resolveInsideRoot(root, mediaDir, 'UNSAFE_MEDIA_PATH');
}

async function writeFileAtomic(target: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function renderFrame(
  track: TerminalTrack,
  presentation: TerminalPresentation,
  layout: TerminalLayout,
  atMs: number,
  rasterizer: Rasterizer,
): Buffer {
  const frame = replayPresentation(track, presentation, atMs);
  return rasterizer.rasterize(renderTerminalSvg(frame, layout)).png;
}

export async function renderTerminalTrack(
  trackInput: TerminalTrack,
  options: RenderTerminalTrackOptions,
): Promise<RenderedMedia> {
  const track = TerminalTrackSchema.parse(trackInput);
  const presentation = createTerminalPresentation(track);
  const finalFrame = replayPresentation(track, presentation, presentation.durationMs);
  const layout = createTerminalLayout(track.columns, track.rows, finalFrame.rows);
  const rasterizer = options.rasterizer ?? new ResvgRasterizer();
  const outputPath = path.resolve(options.outputPath);

  if (options.format === 'png') {
    const png = renderFrame(track, presentation, layout, presentation.durationMs, rasterizer);
    await writeFileAtomic(outputPath, png);
    return {
      format: 'png',
      outputPath,
      width: layout.width,
      height: layout.height,
      sizeBytes: png.length,
    };
  }

  if (!(await ffmpegVersion(options.ffmpegPath, options.processRunner))) {
    throw new RendererError('FFMPEG_NOT_FOUND', 'FFmpeg is required for GIF rendering. Install FFmpeg and ensure `ffmpeg` is available on PATH. PNG rendering remains available without it.');
  }

  const frameTimes = presentationFrameTimes(presentation);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-render-'));
  try {
    for (let index = 0; index < frameTimes.length; index += 1) {
      const framePath = path.join(temporaryDirectory, `frame-${String(index).padStart(5, '0')}.png`);
      await fs.writeFile(framePath, renderFrame(track, presentation, layout, frameTimes[index]!, rasterizer));
    }
    const encodedPath = path.join(temporaryDirectory, 'output.gif');
    await encodeGif(
      path.join(temporaryDirectory, 'frame-%05d.png'),
      path.join(temporaryDirectory, 'palette.png'),
      encodedPath,
      presentation.framesPerSecond,
      options.ffmpegPath,
      options.processRunner,
    );
    await writeFileAtomic(outputPath, await fs.readFile(encodedPath));
    const stat = await fs.stat(outputPath);
    return {
      format: 'gif',
      outputPath,
      width: layout.width,
      height: layout.height,
      sizeBytes: stat.size,
      durationMs: frameTimes.length * 1_000 / presentation.framesPerSecond,
      frameCount: frameTimes.length,
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function derivedEvidence(source: Evidence, format: 'png' | 'gif', root: string, outputPath: string): Evidence {
  const id = `${source.id}-${format}`;
  return {
    schemaVersion: 1,
    id,
    kind: format === 'png' ? 'image' : 'recording',
    status: 'available',
    label: `${source.label ?? source.id} (${format.toUpperCase()})`,
    format,
    path: repositoryPath(root, outputPath),
    mimeType: format === 'png' ? 'image/png' : 'image/gif',
    producer: { kind: 'renderer', id: 'terminal', version: rendererVersion },
    provenance: {
      ...source.provenance,
      sources: source.provenance.sources.map((dependency) => ({ ...dependency })),
    },
    derivedFrom: [source.id],
  };
}

export async function renderEvidence(reference: string, options: RenderEvidenceOptions): Promise<RenderedMedia> {
  const root = path.resolve(options.projectRoot ?? '.');
  const resolved = await resolveSource(reference, root);
  const baseName = resolved.source.sourceEvidenceId
    ?? path.basename(resolved.source.sourcePath).replace(/\.terminal\.json$/i, '').replace(/\.json$/i, '');
  const outputPath = options.outputPath
    ? resolveInsideRoot(root, options.outputPath, 'UNSAFE_OUTPUT_PATH')
    : path.join(await configuredMediaDirectory(root), `${baseName}.${options.format}`);

  const result = await renderTerminalTrack(resolved.source.track, {
    format: options.format,
    outputPath,
    ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
    ...(options.rasterizer ? { rasterizer: options.rasterizer } : {}),
    ...(options.processRunner ? { processRunner: options.processRunner } : {}),
  });

  if (!resolved.evidence || !resolved.manifest || !resolved.manifestPath) return result;
  const evidence = derivedEvidence(resolved.evidence, options.format, root, outputPath);
  const manifest = normalizeManifest({
    ...resolved.manifest,
    evidence: [...resolved.manifest.evidence.filter((item) => item.id !== evidence.id), evidence],
  });
  await writeFileAtomic(resolved.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...result, evidenceId: evidence.id, sourceEvidenceId: resolved.evidence.id };
}

export async function getRendererCapabilities(
  options: { ffmpegPath?: string; processRunner?: ProcessRunner } = {},
): Promise<RendererCapabilities> {
  const version = await ffmpegVersion(options.ffmpegPath, options.processRunner);
  return {
    png: true,
    gif: Boolean(version),
    webm: false,
    mp4: false,
    ...(version ? { ffmpegVersion: version } : {}),
  };
}
