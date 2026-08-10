import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ManifestSchema,
  TimelinePlanSchema,
  normalizeManifest,
  type Evidence,
  type Manifest,
  type SourceDependency,
  type TimelinePane,
  type TimelinePlan,
  type TimelineScene,
} from '@demoweave/core';
import { ffmpegVersion, RendererError, runProcess, type ProcessRunner } from './ffmpeg.js';
import { rendererVersion } from './render.js';

export type CompositionFormat = 'mp4' | 'gif';

export type MediaInfo = {
  format: 'png' | 'gif';
  width: number;
  height: number;
  durationMs?: number;
  frameCount?: number;
};

export type ResolvedTimelineSource = MediaInfo & {
  path: string;
  projectPath: string;
  hash: `sha256:${string}`;
  evidenceId?: string;
};

export type ResolvedTimelinePane = TimelinePane & { resolved: ResolvedTimelineSource };
export type ResolvedTimelineScene = Omit<TimelineScene, 'panes'> & { panes: ResolvedTimelinePane[] };
export type ResolvedTimeline = {
  plan: TimelinePlan;
  planPath: string;
  projectPlanPath: string;
  planHash: `sha256:${string}`;
  scenes: ResolvedTimelineScene[];
  manifestPath: string;
  manifest: Manifest;
};

export type PaneRectangle = { x: number; y: number; width: number; height: number };
export type CompiledLayout = { panes: PaneRectangle[]; padding: number; gap: number };

export type ComposeTimelineOptions = {
  projectRoot?: string;
  format: CompositionFormat;
  outputPath?: string;
  ffmpegPath?: string;
  processRunner?: ProcessRunner;
};

export type ComposedMedia = {
  format: CompositionFormat;
  outputPath: string;
  width: number;
  height: number;
  framesPerSecond: number;
  durationMs: number;
  frameCount: number;
  sizeBytes: number;
  evidenceId: string;
  sourceEvidenceIds: string[];
};

function sha256(data: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function ordinaryWindowsPath(target: string): string {
  if (target.startsWith('\\\\?\\UNC\\')) return `\\\\${target.slice(8)}`;
  if (target.startsWith('\\\\?\\')) return target.slice(4);
  return target;
}

function repositoryPath(root: string, target: string): string {
  return path.relative(ordinaryWindowsPath(root), ordinaryWindowsPath(target)).split(path.sep).join('/');
}

function unsafePortablePath(value: string): boolean {
  const portable = value.replaceAll('\\', '/');
  return !portable || path.isAbsolute(value) || /^[a-zA-Z]:\//.test(portable) || portable.startsWith('//')
    || portable.split('/').some((part) => part === '..');
}

function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveExistingInsideRoot(root: string, relative: string, code: string): Promise<string> {
  if (unsafePortablePath(relative)) throw new RendererError(code, `Path must be project-relative and remain inside the project root: ${relative}`);
  const target = path.resolve(root, relative.replaceAll('\\', path.sep));
  if (!insideRoot(root, target)) throw new RendererError(code, `Path must remain inside the project root: ${relative}`);
  let realTarget: string;
  let realRoot: string;
  try {
    [realTarget, realRoot] = await Promise.all([fs.realpath(target), fs.realpath(root)]);
  } catch (error) {
    throw new RendererError('SOURCE_NOT_FOUND', `Source file does not exist: ${relative}`, { cause: error });
  }
  if (!insideRoot(realRoot, realTarget)) throw new RendererError(code, `Path resolves through a symlink outside the project root: ${relative}`);
  const stat = await fs.stat(realTarget);
  if (!stat.isFile()) throw new RendererError('SOURCE_NOT_FOUND', `Source is not a file: ${relative}`);
  return realTarget;
}

async function resolveOutputInsideRoot(root: string, relative: string): Promise<string> {
  if (unsafePortablePath(relative)) throw new RendererError('UNSAFE_OUTPUT_PATH', `Output path must be project-relative and remain inside the project root: ${relative}`);
  const target = path.resolve(root, relative.replaceAll('\\', path.sep));
  if (!insideRoot(root, target)) throw new RendererError('UNSAFE_OUTPUT_PATH', `Output path must remain inside the project root: ${relative}`);
  const realRoot = await fs.realpath(root);
  let existing = target;
  while (!(await pathExists(existing))) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = await fs.realpath(existing);
  if (!insideRoot(realRoot, realExisting)) {
    throw new RendererError('UNSAFE_OUTPUT_PATH', `Output path resolves through a symlink outside the project root: ${relative}`);
  }
  return target;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function parsePng(bytes: Buffer): MediaInfo | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return undefined;
  return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function parseGif(bytes: Buffer): MediaInfo | undefined {
  if (bytes.length < 13 || !/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return undefined;
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  let offset = 13;
  const packed = bytes[10]!;
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1);
  let pendingDelay = 0;
  let durationMs = 0;
  let frameCount = 0;

  const skipSubBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++]!;
      if (size === 0) break;
      offset += size;
    }
  };

  while (offset < bytes.length) {
    const marker = bytes[offset++]!;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = bytes[offset++]!;
      if (label === 0xf9 && bytes[offset] === 4 && offset + 5 < bytes.length) {
        offset += 2;
        pendingDelay = bytes.readUInt16LE(offset) * 10;
        offset += 4;
      } else {
        skipSubBlocks();
      }
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) return undefined;
    const imagePacked = bytes[offset + 8]!;
    offset += 9;
    if (imagePacked & 0x80) offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
    offset += 1;
    skipSubBlocks();
    frameCount += 1;
    durationMs += pendingDelay || 100;
    pendingDelay = 0;
  }
  if (!frameCount) return undefined;
  return { format: 'gif', width, height, durationMs, frameCount };
}

export function inspectMediaBytes(bytes: Buffer): MediaInfo {
  const media = parsePng(bytes) ?? parseGif(bytes);
  if (!media || media.width <= 0 || media.height <= 0) {
    throw new RendererError('UNSUPPORTED_SOURCE_FORMAT', 'Timeline sources must be valid PNG or GIF media.');
  }
  return media;
}

async function readManifest(root: string): Promise<{ path: string; manifest: Manifest }> {
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new RendererError('MANIFEST_NOT_FOUND', 'DemoWeave evidence manifest is missing or unreadable. Run `demoweave init .` first.', { cause: error });
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) throw new RendererError('INVALID_MANIFEST', `Manifest is invalid: ${result.error.issues[0]?.message ?? 'unknown validation error'}`);
  return { path: manifestPath, manifest: result.data };
}

async function resolvePlanPath(reference: string, root: string): Promise<string> {
  if (unsafePortablePath(reference)) throw new RendererError('UNSAFE_TIMELINE_PATH', `Timeline path must be project-relative: ${reference}`);
  const explicit = reference.includes('/') || reference.includes('\\') || reference.endsWith('.json');
  const relative = explicit ? reference : `.demoweave/timelines/${reference}.json`;
  try {
    return await resolveExistingInsideRoot(root, relative, 'UNSAFE_TIMELINE_PATH');
  } catch (error) {
    if (error instanceof RendererError && error.code === 'SOURCE_NOT_FOUND') {
      throw new RendererError('TIMELINE_NOT_FOUND', `TimelinePlan file does not exist: ${relative}`);
    }
    throw error;
  }
}

async function resolveMediaSource(
  root: string,
  pane: TimelinePane,
  manifest: Manifest,
): Promise<ResolvedTimelineSource> {
  let relative: string;
  let evidenceId: string | undefined;
  if (pane.source.kind === 'evidence') {
    const requestedEvidenceId = pane.source.evidenceId;
    const evidence = manifest.evidence.find((item) => item.id === requestedEvidenceId);
    if (!evidence) throw new RendererError('EVIDENCE_NOT_FOUND', `Timeline references missing Evidence: ${requestedEvidenceId}`);
    if (evidence.status !== 'available' && evidence.status !== 'stale') {
      throw new RendererError('EVIDENCE_UNAVAILABLE', `Evidence ${evidence.id} has status ${evidence.status}; composition requires available or stale source evidence.`);
    }
    if (!evidence.path) throw new RendererError('SOURCE_NOT_FOUND', `Evidence ${evidence.id} does not declare an artifact path.`);
    if (evidence.format !== 'png' && evidence.format !== 'gif') {
      throw new RendererError('UNSUPPORTED_SOURCE_FORMAT', `Evidence ${evidence.id} has unsupported format ${evidence.format ?? 'unknown'}; expected PNG or GIF.`);
    }
    relative = evidence.path;
    evidenceId = evidence.id;
  } else {
    relative = pane.source.path;
    if (!/\.(png|gif)$/i.test(relative)) {
      throw new RendererError('UNSUPPORTED_SOURCE_FORMAT', `File source has unsupported extension: ${relative}. Expected .png or .gif.`);
    }
  }

  const target = await resolveExistingInsideRoot(root, relative, 'UNSAFE_SOURCE_PATH');
  const bytes = await fs.readFile(target);
  const media = inspectMediaBytes(bytes);
  const declaredExtension = path.extname(relative).slice(1).toLowerCase();
  if (declaredExtension !== media.format) {
    throw new RendererError('UNSUPPORTED_SOURCE_FORMAT', `Source extension and media bytes do not agree: ${relative}`);
  }
  return {
    ...media,
    path: target,
    projectPath: repositoryPath(root, target),
    hash: sha256(bytes),
    ...(evidenceId ? { evidenceId } : {}),
  };
}

export async function resolveTimeline(reference: string, projectRoot = '.'): Promise<ResolvedTimeline> {
  const root = path.resolve(projectRoot);
  const planPath = await resolvePlanPath(reference, root);
  const planBytes = await fs.readFile(planPath);
  let input: unknown;
  try {
    input = JSON.parse(planBytes.toString('utf8'));
  } catch (error) {
    throw new RendererError('INVALID_TIMELINE', `TimelinePlan is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const parsed = TimelinePlanSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RendererError('INVALID_TIMELINE', `TimelinePlan v1 is invalid at ${issue?.path.join('.') || '<root>'}: ${issue?.message ?? 'unknown validation error'}`);
  }
  const { path: manifestPath, manifest } = await readManifest(root);
  const scenes: ResolvedTimelineScene[] = [];
  for (const scene of parsed.data.scenes) {
    const panes: ResolvedTimelinePane[] = [];
    for (const pane of scene.panes) panes.push({ ...pane, resolved: await resolveMediaSource(root, pane, manifest) });
    scenes.push({ ...scene, panes });
  }
  return {
    plan: parsed.data,
    planPath,
    projectPlanPath: repositoryPath(root, planPath),
    planHash: sha256(planBytes),
    scenes,
    manifestPath,
    manifest,
  };
}

export function compileLayout(plan: TimelinePlan, scene: TimelineScene): CompiledLayout {
  const padding = scene.layout.padding ?? 36;
  const gap = scene.layout.type === 'split' ? scene.layout.gap ?? 28 : 0;
  const innerWidth = plan.canvas.width - padding * 2 - gap;
  const height = plan.canvas.height - padding * 2;
  if (scene.layout.type === 'single') {
    return { padding, gap, panes: [{ x: padding, y: padding, width: innerWidth, height }] };
  }
  const firstWidth = Math.floor(innerWidth * (scene.layout.ratio ?? 0.5));
  const secondWidth = innerWidth - firstWidth;
  return {
    padding,
    gap,
    panes: [
      { x: padding, y: padding, width: firstWidth, height },
      { x: padding + firstWidth + gap, y: padding, width: secondWidth, height },
    ],
  };
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1_000).toFixed(3);
}

function fitFilter(pane: ResolvedTimelinePane, rectangle: PaneRectangle): string {
  const size = `${rectangle.width}:${rectangle.height}`;
  if (pane.fit === 'cover') {
    return `scale=${size}:force_original_aspect_ratio=increase,crop=${size},setsar=1`;
  }
  return `scale=${size}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${size}:(ow-iw)/2:(oh-ih)/2:color=#151925,setsar=1`;
}

export function compileCompositionArguments(
  timeline: ResolvedTimeline,
  format: CompositionFormat,
  outputPath: string,
): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  const filters: string[] = [];
  let inputIndex = 0;
  const sceneLabels: string[] = [];

  timeline.scenes.forEach((scene, sceneIndex) => {
    const duration = seconds(scene.durationMs);
    const layout = compileLayout(timeline.plan, scene);
    scene.panes.forEach((pane) => {
      if (pane.resolved.format === 'png') args.push('-loop', '1', '-framerate', String(timeline.plan.canvas.fps));
      else args.push('-stream_loop', '-1');
      args.push('-i', pane.resolved.path);
    });

    const baseLabel = `scene${sceneIndex}base`;
    filters.push(`color=c=${timeline.plan.canvas.background}:s=${timeline.plan.canvas.width}x${timeline.plan.canvas.height}:r=${timeline.plan.canvas.fps}:d=${duration}[${baseLabel}]`);
    let previous = baseLabel;
    scene.panes.forEach((pane, paneIndex) => {
      const rectangle = layout.panes[paneIndex]!;
      const paneLabel = `scene${sceneIndex}pane${paneIndex}`;
      const next = `scene${sceneIndex}layer${paneIndex}`;
      filters.push(`[${inputIndex}:v]fps=${timeline.plan.canvas.fps},${fitFilter(pane, rectangle)},trim=duration=${duration},setpts=PTS-STARTPTS[${paneLabel}]`);
      filters.push(`[${previous}][${paneLabel}]overlay=x=${rectangle.x}:y=${rectangle.y}:shortest=1:eof_action=pass[${next}]`);
      previous = next;
      inputIndex += 1;
    });
    const sceneLabel = `scene${sceneIndex}`;
    filters.push(`[${previous}]trim=duration=${duration},setpts=PTS-STARTPTS[${sceneLabel}]`);
    sceneLabels.push(`[${sceneLabel}]`);
  });

  const timelineLabel = timeline.scenes.length === 1 ? 'scene0' : 'timeline';
  if (timeline.scenes.length > 1) filters.push(`${sceneLabels.join('')}concat=n=${timeline.scenes.length}:v=1:a=0[${timelineLabel}]`);
  let outputLabel = timelineLabel;
  if (format === 'gif') {
    filters.push(`[${timelineLabel}]split[palette-source][gif-source]`);
    filters.push('[palette-source]palettegen=stats_mode=diff:max_colors=256[palette]');
    filters.push('[gif-source][palette]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[outv]');
    outputLabel = 'outv';
  }
  args.push('-filter_complex', filters.join(';'), '-map', `[${outputLabel}]`, '-an', '-map_metadata', '-1');
  if (format === 'mp4') {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(timeline.plan.canvas.fps), '-movflags', '+faststart');
  } else {
    args.push('-loop', '0', '-final_delay', String(Math.max(1, Math.round(100 / timeline.plan.canvas.fps))));
  }
  args.push(outputPath);
  return args;
}

async function configuredMediaDirectory(root: string): Promise<string> {
  const configPath = path.join(root, '.demoweave', 'config.json');
  if (!(await pathExists(configPath))) return await resolveOutputInsideRoot(root, 'docs-media');
  let config: unknown;
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    throw new RendererError('INVALID_CONFIG', `DemoWeave config is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const mediaDir = config && typeof config === 'object' && !Array.isArray(config) ? Reflect.get(config, 'mediaDir') : undefined;
  const schemaVersion = config && typeof config === 'object' && !Array.isArray(config) ? Reflect.get(config, 'schemaVersion') : undefined;
  if (schemaVersion !== 1 || typeof mediaDir !== 'string' || !mediaDir.trim()) {
    throw new RendererError('INVALID_CONFIG', 'DemoWeave config requires schemaVersion 1 and a non-empty project-relative mediaDir.');
  }
  return await resolveOutputInsideRoot(root, mediaDir);
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

function composedEvidence(
  timeline: ResolvedTimeline,
  format: CompositionFormat,
  root: string,
  outputPath: string,
): Evidence {
  const fileSources = new Map<string, SourceDependency>();
  fileSources.set(timeline.projectPlanPath, { path: timeline.projectPlanPath, role: 'config', hash: timeline.planHash });
  const evidenceIds = new Set<string>();
  for (const scene of timeline.scenes) {
    for (const pane of scene.panes) {
      if (pane.resolved.evidenceId) evidenceIds.add(pane.resolved.evidenceId);
      else fileSources.set(pane.resolved.projectPath, { path: pane.resolved.projectPath, role: 'asset', hash: pane.resolved.hash });
    }
  }
  return {
    schemaVersion: 1,
    id: `${timeline.plan.id}-${format}`,
    kind: 'recording',
    status: 'available',
    label: `${timeline.plan.id} composition (${format.toUpperCase()})`,
    format,
    path: repositoryPath(root, outputPath),
    mimeType: format === 'mp4' ? 'video/mp4' : 'image/gif',
    producer: { kind: 'renderer', id: 'compositor', version: rendererVersion },
    provenance: { sources: [...fileSources.values()] },
    derivedFrom: [...evidenceIds],
  };
}

export async function composeTimeline(reference: string, options: ComposeTimelineOptions): Promise<ComposedMedia> {
  const root = path.resolve(options.projectRoot ?? '.');
  const timeline = await resolveTimeline(reference, root);
  const version = await ffmpegVersion(options.ffmpegPath, options.processRunner);
  if (!version) {
    throw new RendererError('FFMPEG_NOT_FOUND', 'FFmpeg is required for timeline composition. Install FFmpeg and ensure `ffmpeg` is available on PATH.');
  }
  const outputPath = options.outputPath
    ? await resolveOutputInsideRoot(root, options.outputPath)
    : path.join(await configuredMediaDirectory(root), `${timeline.plan.id}.${options.format}`);
  if (path.extname(outputPath).toLowerCase() !== `.${options.format}`) {
    throw new RendererError('OUTPUT_FORMAT_MISMATCH', `Output path must end in .${options.format}: ${repositoryPath(root, outputPath)}`);
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-compose-'));
  try {
    const encodedPath = path.join(temporaryDirectory, `output.${options.format}`);
    const runner = options.processRunner ?? runProcess;
    const result = await runner(options.ffmpegPath ?? 'ffmpeg', compileCompositionArguments(timeline, options.format, encodedPath)).catch((error) => {
      throw new RendererError('FFMPEG_FAILED', `FFmpeg composition could not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    });
    if (result.exitCode !== 0) {
      throw new RendererError('FFMPEG_FAILED', `FFmpeg composition failed (exit ${result.exitCode ?? 'unknown'}): ${result.stderr || 'no diagnostic output'}`);
    }
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(encodedPath);
    } catch (error) {
      throw new RendererError('FFMPEG_FAILED', 'FFmpeg reported success but did not produce the composed output.', { cause: error });
    }
    await writeFileAtomic(outputPath, bytes);

    const evidence = composedEvidence(timeline, options.format, root, outputPath);
    const manifest = normalizeManifest({
      ...timeline.manifest,
      evidence: [...timeline.manifest.evidence.filter((item) => item.id !== evidence.id), evidence],
    });
    await writeFileAtomic(timeline.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const durationMs = timeline.plan.scenes.reduce((total, scene) => total + scene.durationMs, 0);
    return {
      format: options.format,
      outputPath,
      width: timeline.plan.canvas.width,
      height: timeline.plan.canvas.height,
      framesPerSecond: timeline.plan.canvas.fps,
      durationMs,
      frameCount: Math.ceil(durationMs * timeline.plan.canvas.fps / 1_000),
      sizeBytes: bytes.length,
      evidenceId: evidence.id,
      sourceEvidenceIds: evidence.derivedFrom ?? [],
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
