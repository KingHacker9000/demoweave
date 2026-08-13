import {
  EvidenceFormatSchema,
  EvidenceSchema,
  ManifestSchema,
  TerminalTrackSchema,
  normalizeManifest,
  type Evidence,
  type EvidenceFormat,
  type EvidenceKind,
  type Manifest,
  type TerminalTrack,
} from '@demoweave/core';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeGif, ffmpegVersion, RendererError, type ProcessRunner } from './ffmpeg.js';
import type {
  RenderedMedia,
  RenderedTerminalMedia,
  TerminalLayout,
  TerminalPresentation,
} from './model.js';
import { createTerminalPresentation, presentationFrameTimes, replayPresentation } from './presentation.js';
import { ResvgRasterizer, type Rasterizer } from './rasterizer.js';
import { createTerminalLayout, renderTerminalSvg } from './svg-renderer.js';

export const rendererVersion = '0.0.1';

export type RendererCapabilities = {
  png: true;
  gif: boolean;
  webm: false;
  mp4: boolean;
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
  format: EvidenceFormat;
  rendererId?: string;
  pluginHost?: PluginRendererHost;
  outputPath?: string;
  ffmpegPath?: string;
  rasterizer?: Rasterizer;
  processRunner?: ProcessRunner;
};

export interface PluginRendererDescriptor {
  id: string;
  contributionId: string;
  accepts: Array<{ kinds: EvidenceKind[]; formats: EvidenceFormat[] }>;
  outputFormats: EvidenceFormat[];
  version?: string;
  pluginFingerprint: string;
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export interface PluginRendererHost {
  rendererDescriptors(): PluginRendererDescriptor[];
  renderWith(rendererId: string, input: {
    source: DeepReadonly<Evidence>;
    sourceBytes: Readonly<Uint8Array>;
    format: EvidenceFormat;
  }): Promise<{
    descriptor: PluginRendererDescriptor;
    result: {
      kind: EvidenceKind;
      format: EvidenceFormat;
      mimeType: string;
      data: string | Uint8Array;
      label?: string;
    };
  }>;
}

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
  if (path.isAbsolute(target) || path.win32.isAbsolute(target)) {
    throw new RendererError(code, `Path must be project-relative: ${target}`);
  }
  const resolved = path.resolve(root, target);
  if (!insideRoot(root, resolved)) {
    throw new RendererError(code, `Path must remain inside the project root: ${target}`);
  }
  return resolved;
}

async function resolveExistingInsideRoot(root: string, target: string, code: string): Promise<string> {
  if (path.win32.isAbsolute(target) && !path.isAbsolute(target)) {
    throw new RendererError(code, `Path must remain inside the project root: ${target}`);
  }
  const canonicalRoot = await fs.realpath(root);
  const requested = path.isAbsolute(target) ? target : path.resolve(canonicalRoot, target);
  if (!insideRoot(canonicalRoot, requested)) throw new RendererError(code, `Path must remain inside the project root: ${target}`);
  let resolved: string;
  try {
    resolved = await fs.realpath(requested);
  } catch {
    throw new RendererError('SOURCE_ARTIFACT_NOT_FOUND', `Source artifact does not exist: ${target}`);
  }
  if (!insideRoot(canonicalRoot, resolved)) throw new RendererError(code, `Path resolves outside the project root: ${target}`);
  return resolved;
}

async function resolveOutputInsideRoot(root: string, target: string, code: string): Promise<string> {
  const resolved = resolveInsideRoot(root, target, code);
  const canonicalRoot = await fs.realpath(root);
  let ancestor = path.dirname(resolved);
  while (!(await pathExists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const canonicalAncestor = await fs.realpath(ancestor);
  if (!insideRoot(canonicalRoot, canonicalAncestor)) throw new RendererError(code, `Path resolves outside the project root: ${target}`);
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

type ResolvedSource = {
  sourcePath: string;
  sourceBytes: Buffer;
  manifestPath?: string;
  manifest?: Manifest;
  evidence?: Evidence;
  track?: TerminalTrack;
};

async function resolveSource(
  reference: string,
  root: string,
): Promise<ResolvedSource> {
  const pathCandidate = path.isAbsolute(reference) ? reference : path.resolve(root, reference);
  if (await pathExists(pathCandidate)) {
    const sourcePath = await resolveExistingInsideRoot(root, reference, 'UNSAFE_SOURCE_PATH');
    return { sourcePath, sourceBytes: await fs.readFile(sourcePath), track: await loadTrack(sourcePath) };
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
  if (!evidence.path) {
    throw new RendererError('SOURCE_ARTIFACT_NOT_FOUND', `Evidence ${evidence.id} does not declare an artifact path.`);
  }
  if (path.isAbsolute(evidence.path) || path.win32.isAbsolute(evidence.path)) {
    throw new RendererError('UNSAFE_SOURCE_PATH', `Evidence ${evidence.id} artifact path must be project-relative: ${evidence.path}`);
  }
  const sourcePath = await resolveExistingInsideRoot(root, evidence.path, 'UNSAFE_SOURCE_PATH');
  return {
    sourcePath,
    sourceBytes: await fs.readFile(sourcePath),
    manifestPath,
    manifest,
    evidence,
  };
}

async function configuredMediaDirectory(root: string): Promise<string> {
  const configPath = path.join(root, '.demoweave', 'config.json');
  if (!(await pathExists(configPath))) return resolveOutputInsideRoot(root, 'docs-media', 'UNSAFE_MEDIA_PATH');
  const config = await readJson(configPath, 'INVALID_CONFIG');
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new RendererError('INVALID_CONFIG', 'DemoWeave config must be a JSON object.');
  }
  const schemaVersion = Reflect.get(config, 'schemaVersion');
  const mediaDir = Reflect.get(config, 'mediaDir');
  if (schemaVersion !== 1 || typeof mediaDir !== 'string' || !mediaDir.trim() || path.isAbsolute(mediaDir) || path.win32.isAbsolute(mediaDir)) {
    throw new RendererError('INVALID_CONFIG', 'DemoWeave config requires schemaVersion 1 and a non-empty project-relative mediaDir.');
  }
  return resolveOutputInsideRoot(root, mediaDir, 'UNSAFE_MEDIA_PATH');
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
): Promise<RenderedTerminalMedia> {
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

function sha256(data: Buffer | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

type RendererCandidate =
  | { id: 'terminal'; contributionId: 'terminal'; kind: 'built-in' }
  | { id: string; contributionId: string; kind: 'plugin'; descriptor: PluginRendererDescriptor };

function eligibleRenderers(source: Evidence, format: EvidenceFormat, host?: PluginRendererHost): RendererCandidate[] {
  const candidates: RendererCandidate[] = [];
  if (source.kind === 'terminal' && source.format === 'json' && (format === 'png' || format === 'gif')) {
    candidates.push({ id: 'terminal', contributionId: 'terminal', kind: 'built-in' });
  }
  for (const descriptor of host?.rendererDescriptors() ?? []) {
    if (!descriptor.outputFormats.includes(format)) continue;
    if (!descriptor.accepts.some((accepts) => accepts.kinds.includes(source.kind) && source.format !== undefined && accepts.formats.includes(source.format))) continue;
    candidates.push({ id: descriptor.id, contributionId: descriptor.contributionId, kind: 'plugin', descriptor });
  }
  return candidates.sort((left, right) => left.id.localeCompare(right.id));
}

function selectRenderer(source: Evidence, format: EvidenceFormat, rendererId: string | undefined, host?: PluginRendererHost): RendererCandidate {
  const eligible = eligibleRenderers(source, format, host);
  if (rendererId) {
    const selected = eligible.find((candidate) => candidate.id === rendererId);
    if (selected) return selected;
    const known = rendererId === 'terminal' || (host?.rendererDescriptors() ?? []).some((candidate) => candidate.id === rendererId);
    throw new RendererError(known ? 'RENDERER_INELIGIBLE' : 'RENDERER_NOT_FOUND', known
      ? `Renderer ${rendererId} does not accept ${source.kind}/${source.format ?? 'unknown'} Evidence as ${format}.`
      : `Renderer not found: ${rendererId}`);
  }
  if (eligible.length === 0) {
    throw new RendererError('RENDER_UNSUPPORTED', `No renderer accepts ${source.kind}/${source.format ?? 'unknown'} Evidence as ${format}.`);
  }
  if (eligible.length > 1) {
    throw new RendererError('RENDERER_AMBIGUOUS', `Multiple renderers accept ${source.kind}/${source.format ?? 'unknown'} Evidence as ${format}: ${eligible.map((candidate) => candidate.id).join(', ')}. Pass --renderer with one exact id.`);
  }
  return eligible[0]!;
}

function derivedEvidence(
  source: Evidence,
  root: string,
  outputPath: string,
  bytes: Buffer,
  input: {
    id: string;
    kind: EvidenceKind;
    format: EvidenceFormat;
    mimeType: string;
    label?: string;
    producer: NonNullable<Evidence['producer']>;
  },
): Evidence {
  return EvidenceSchema.parse({
    schemaVersion: 1,
    id: input.id,
    kind: input.kind,
    status: 'available',
    ...(input.label ? { label: input.label } : {}),
    format: input.format,
    path: repositoryPath(root, outputPath),
    artifactHash: sha256(bytes),
    mimeType: input.mimeType,
    producer: input.producer,
    provenance: structuredClone(source.provenance),
    derivedFrom: [source.id],
  });
}

export async function renderEvidence(reference: string, options: RenderEvidenceOptions): Promise<RenderedMedia> {
  const root = path.resolve(options.projectRoot ?? '.');
  const parsedFormat = EvidenceFormatSchema.safeParse(options.format);
  if (!parsedFormat.success) throw new RendererError('RENDER_FORMAT_INVALID', `Unsupported Evidence format: ${String(options.format)}.`);
  const resolved = await resolveSource(reference, root);
  if (!resolved.evidence) {
    if (options.rendererId && options.rendererId !== 'terminal') {
      throw new RendererError('RENDERER_INELIGIBLE', 'External renderers require an Evidence id from Manifest v1; direct paths support only renderer terminal.');
    }
    if (options.format !== 'png' && options.format !== 'gif') {
      throw new RendererError('RENDER_UNSUPPORTED', `Renderer terminal does not support ${options.format}.`);
    }
    const baseName = path.basename(resolved.sourcePath).replace(/\.terminal\.json$/i, '').replace(/\.json$/i, '');
    const outputPath = options.outputPath
      ? await resolveOutputInsideRoot(root, options.outputPath, 'UNSAFE_OUTPUT_PATH')
      : path.join(await configuredMediaDirectory(root), `${baseName}.${options.format}`);
    return renderTerminalTrack(resolved.track ?? await loadTrack(resolved.sourcePath), {
      format: options.format,
      outputPath,
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
      ...(options.rasterizer ? { rasterizer: options.rasterizer } : {}),
      ...(options.processRunner ? { processRunner: options.processRunner } : {}),
    });
  }

  const source = resolved.evidence;
  const selected = selectRenderer(source, options.format, options.rendererId, options.pluginHost);
  const evidenceId = selected.kind === 'built-in'
    ? `${source.id}-${options.format}`
    : `${source.id}-${selected.contributionId}-${options.format}`;
  const expectedProducerId = selected.id;
  const conflict = resolved.manifest?.evidence.find((item) => item.id === evidenceId && item.producer?.id !== expectedProducerId);
  if (conflict) throw new RendererError('EVIDENCE_ID_CONFLICT', `Derived Evidence id ${evidenceId} belongs to another producer.`);
  const outputPath = options.outputPath
    ? await resolveOutputInsideRoot(root, options.outputPath, 'UNSAFE_OUTPUT_PATH')
    : path.join(await configuredMediaDirectory(root), `${selected.kind === 'built-in' ? source.id : evidenceId}.${options.format}`);

  let result: RenderedMedia;
  let evidence: Evidence;
  if (selected.kind === 'built-in') {
    if (options.format !== 'png' && options.format !== 'gif') throw new RendererError('RENDER_UNSUPPORTED', `Renderer terminal does not support ${options.format}.`);
    const terminalResult = await renderTerminalTrack(await loadTrack(resolved.sourcePath), {
      format: options.format,
      outputPath,
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
      ...(options.rasterizer ? { rasterizer: options.rasterizer } : {}),
      ...(options.processRunner ? { processRunner: options.processRunner } : {}),
    });
    const bytes = await fs.readFile(outputPath);
    evidence = derivedEvidence(source, root, outputPath, bytes, {
      id: evidenceId,
      kind: options.format === 'png' ? 'image' : 'recording',
      format: options.format,
      mimeType: options.format === 'png' ? 'image/png' : 'image/gif',
      label: `${source.label ?? source.id} (${options.format.toUpperCase()})`,
      producer: { kind: 'renderer', id: 'terminal', version: rendererVersion },
    });
    result = terminalResult;
  } else {
    if (!options.pluginHost) throw new RendererError('RENDERER_NOT_FOUND', `Plugin renderer is unavailable: ${selected.id}`);
    let rendered;
    try {
      rendered = await options.pluginHost.renderWith(selected.id, {
        source,
        sourceBytes: Uint8Array.from(resolved.sourceBytes),
        format: options.format,
      });
    } catch (error) {
      const code = typeof error === 'object' && error && typeof Reflect.get(error, 'code') === 'string'
        ? String(Reflect.get(error, 'code'))
        : 'PLUGIN_RENDERER_FAILED';
      throw new RendererError(code, error instanceof Error ? error.message : String(error), { cause: error });
    }
    const bytes = typeof rendered.result.data === 'string' ? Buffer.from(rendered.result.data) : Buffer.from(rendered.result.data);
    await writeFileAtomic(outputPath, bytes);
    evidence = derivedEvidence(source, root, outputPath, bytes, {
      id: evidenceId,
      kind: rendered.result.kind,
      format: rendered.result.format,
      mimeType: rendered.result.mimeType,
      ...(rendered.result.label ? { label: rendered.result.label } : {}),
      producer: {
        kind: 'renderer',
        id: selected.id,
        ...(selected.descriptor.version ? { version: selected.descriptor.version } : {}),
        pluginFingerprint: selected.descriptor.pluginFingerprint,
      },
    });
    result = { format: options.format, outputPath, sizeBytes: bytes.length };
  }

  if (!resolved.manifest || !resolved.manifestPath) throw new RendererError('INVALID_MANIFEST', 'Evidence rendering requires Manifest v1.');
  const manifest = normalizeManifest({
    ...resolved.manifest,
    evidence: [...resolved.manifest.evidence.filter((item) => item.id !== evidence.id), evidence],
  });
  await writeFileAtomic(resolved.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...result, evidenceId: evidence.id, sourceEvidenceId: source.id };
}

export async function getRendererCapabilities(
  options: { ffmpegPath?: string; processRunner?: ProcessRunner } = {},
): Promise<RendererCapabilities> {
  const version = await ffmpegVersion(options.ffmpegPath, options.processRunner);
  return {
    png: true,
    gif: Boolean(version),
    webm: false,
    mp4: Boolean(version),
    ...(version ? { ffmpegVersion: version } : {}),
  };
}
