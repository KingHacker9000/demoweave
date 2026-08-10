import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ManifestSchema,
  TutorialPlanSchema,
  normalizeManifest,
  type Evidence,
  type Manifest,
  type TutorialCaptionCue,
  type TutorialPlan,
} from '@demoweave/core';
import { RendererError, runProcess, type ProcessRunner } from './ffmpeg.js';
import { ResvgRasterizer, type Rasterizer } from './rasterizer.js';
import { rendererVersion } from './render.js';

export type TutorialBuildOptions = {
  projectRoot?: string;
  outputDirectory?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  processRunner?: ProcessRunner;
  rasterizer?: Rasterizer;
};

export type VideoProbe = {
  width: number;
  height: number;
  durationMs: number;
};

export type TutorialBuildResult = {
  id: string;
  sourceEvidenceId: string;
  width: number;
  height: number;
  durationMs: number;
  outputDirectory: string;
  videoPath: string;
  thumbnailPath: string;
  srtPath: string;
  vttPath: string;
  chaptersPath: string;
  descriptionPath: string;
  metadataPath: string;
  evidenceIds: string[];
};

type ResolvedTutorial = {
  root: string;
  plan: TutorialPlan;
  planPath: string;
  projectPlanPath: string;
  planHash: `sha256:${string}`;
  manifestPath: string;
  manifest: Manifest;
  sourceEvidence: Evidence;
  sourcePath: string;
  sourceHash: `sha256:${string}`;
};

function sha256(data: Buffer | string): `sha256:${string}` {
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

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
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
  if (!(await fs.stat(realTarget)).isFile()) throw new RendererError('SOURCE_NOT_FOUND', `Source is not a file: ${relative}`);
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
  if (!insideRoot(realRoot, realExisting)) throw new RendererError('UNSAFE_OUTPUT_PATH', `Output path resolves through a symlink outside the project root: ${relative}`);
  return target;
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

async function readManifest(root: string): Promise<{ path: string; manifest: Manifest }> {
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  let input: unknown;
  try {
    input = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new RendererError('MANIFEST_NOT_FOUND', 'DemoWeave evidence manifest is missing or unreadable. Run `demoweave init .` first.', { cause: error });
  }
  const parsed = ManifestSchema.safeParse(input);
  if (!parsed.success) throw new RendererError('INVALID_MANIFEST', `Manifest is invalid: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`);
  return { path: manifestPath, manifest: parsed.data };
}

async function resolvePlanPath(reference: string, root: string): Promise<string> {
  if (unsafePortablePath(reference)) throw new RendererError('UNSAFE_TUTORIAL_PATH', `Tutorial path must be project-relative: ${reference}`);
  const explicit = reference.includes('/') || reference.includes('\\') || reference.endsWith('.json');
  const relative = explicit ? reference : `.demoweave/tutorials/${reference}.json`;
  try {
    return await resolveExistingInsideRoot(root, relative, 'UNSAFE_TUTORIAL_PATH');
  } catch (error) {
    if (error instanceof RendererError && error.code === 'SOURCE_NOT_FOUND') {
      throw new RendererError('TUTORIAL_NOT_FOUND', `TutorialPlan file does not exist: ${relative}`);
    }
    throw error;
  }
}

export async function resolveTutorial(reference: string, projectRoot = '.'): Promise<ResolvedTutorial> {
  const root = await fs.realpath(path.resolve(projectRoot));
  const planPath = await resolvePlanPath(reference, root);
  const planBytes = await fs.readFile(planPath);
  let input: unknown;
  try {
    input = JSON.parse(planBytes.toString('utf8'));
  } catch (error) {
    throw new RendererError('INVALID_TUTORIAL', `TutorialPlan is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const parsed = TutorialPlanSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RendererError('INVALID_TUTORIAL', `TutorialPlan v1 is invalid at ${issue?.path.join('.') || '<root>'}: ${issue?.message ?? 'unknown validation error'}`);
  }
  const { path: manifestPath, manifest } = await readManifest(root);
  const sourceEvidence = manifest.evidence.find((item) => item.id === parsed.data.video.evidenceId);
  if (!sourceEvidence) throw new RendererError('EVIDENCE_NOT_FOUND', `Tutorial references missing video Evidence: ${parsed.data.video.evidenceId}`);
  if (sourceEvidence.status !== 'available' && sourceEvidence.status !== 'stale') {
    throw new RendererError('EVIDENCE_UNAVAILABLE', `Video Evidence ${sourceEvidence.id} has status ${sourceEvidence.status}; tutorial packaging requires available or stale Evidence.`);
  }
  if (sourceEvidence.format !== 'mp4' || !sourceEvidence.path) {
    throw new RendererError('WRONG_EVIDENCE_FORMAT', `Video Evidence ${sourceEvidence.id} must be an MP4 artifact.`);
  }
  const sourcePath = await resolveExistingInsideRoot(root, sourceEvidence.path, 'UNSAFE_SOURCE_PATH');
  const sourceBytes = await fs.readFile(sourcePath);
  return {
    root,
    plan: parsed.data,
    planPath,
    projectPlanPath: repositoryPath(root, planPath),
    planHash: sha256(planBytes),
    manifestPath,
    manifest,
    sourceEvidence,
    sourcePath,
    sourceHash: sha256(sourceBytes),
  };
}

export async function probeTutorialVideo(
  sourcePath: string,
  options: { ffprobePath?: string; processRunner?: ProcessRunner } = {},
): Promise<VideoProbe> {
  const runner = options.processRunner ?? runProcess;
  let result;
  try {
    result = await runner(options.ffprobePath ?? 'ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      sourcePath,
    ]);
  } catch (error) {
    throw new RendererError('FFPROBE_NOT_FOUND', `ffprobe could not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (result.exitCode === null) throw new RendererError('FFPROBE_NOT_FOUND', 'ffprobe is required for tutorial video validation and thumbnail timing.');
  if (result.exitCode !== 0) throw new RendererError('VIDEO_PROBE_FAILED', `ffprobe failed (exit ${result.exitCode}): ${result.stderr || 'no diagnostic output'}`);
  let parsed: any;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new RendererError('VIDEO_PROBE_FAILED', 'ffprobe did not return valid JSON.', { cause: error });
  }
  const stream = parsed?.streams?.[0];
  const durationSeconds = Number(parsed?.format?.duration);
  if (!Number.isInteger(stream?.width) || stream.width <= 0 || !Number.isInteger(stream?.height) || stream.height <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new RendererError('VIDEO_PROBE_FAILED', 'ffprobe did not report a valid video stream with dimensions and duration.');
  }
  return { width: stream.width, height: stream.height, durationMs: Math.round(durationSeconds * 1_000) };
}

function validateTiming(plan: TutorialPlan, durationMs: number): void {
  const toleranceMs = 50;
  if (plan.thumbnail.atMs >= durationMs) {
    throw new RendererError('TUTORIAL_TIMING_INVALID', `Thumbnail time ${plan.thumbnail.atMs}ms is outside the ${durationMs}ms video.`);
  }
  for (const cue of plan.captions) {
    if (cue.endMs > durationMs + toleranceMs) {
      throw new RendererError('TUTORIAL_TIMING_INVALID', `Caption ${cue.id} ends at ${cue.endMs}ms, beyond the ${durationMs}ms video.`);
    }
  }
  for (const chapter of plan.chapters) {
    if (chapter.startMs >= durationMs) {
      throw new RendererError('TUTORIAL_TIMING_INVALID', `Chapter ${JSON.stringify(chapter.title)} starts outside the ${durationMs}ms video.`);
    }
  }
}

function subtitleTimestamp(milliseconds: number, decimal: ',' | '.'): string {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${decimal}${String(millis).padStart(3, '0')}`;
}

function normalizedCaptionText(cue: TutorialCaptionCue): string {
  return cue.text.replace(/\r\n?/g, '\n').trim();
}

export function renderSrt(cues: TutorialCaptionCue[]): string {
  return `${cues.map((cue, index) => `${index + 1}\n${subtitleTimestamp(cue.startMs, ',')} --> ${subtitleTimestamp(cue.endMs, ',')}\n${normalizedCaptionText(cue)}`).join('\n\n')}\n`;
}

export function renderVtt(cues: TutorialCaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${cue.id}\n${subtitleTimestamp(cue.startMs, '.')} --> ${subtitleTimestamp(cue.endMs, '.')}\n${normalizedCaptionText(cue)}`).join('\n\n')}\n`;
}

function chapterTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function renderChapters(plan: TutorialPlan): string {
  return `${plan.chapters.map((chapter) => `${chapterTimestamp(chapter.startMs)} ${chapter.title}`).join('\n')}\n`;
}

export function renderDescription(plan: TutorialPlan): string {
  const description = plan.metadata.description.trimEnd();
  const chapters = renderChapters(plan).trimEnd();
  return `${description}${description ? '\n\n' : ''}Chapters\n${chapters}\n`;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function wrapText(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(' ').split(/\s+/).length;
  if (consumed < words.length && lines.length) {
    const last = lines.length - 1;
    lines[last] = `${lines[last]!.replace(/[. …]+$/u, '')}…`;
  }
  return lines;
}

function thumbnailSvg(frame: Buffer, plan: TutorialPlan): string {
  const { width, height } = plan.thumbnail;
  const title = plan.thumbnail.title ?? plan.metadata.title;
  const titleLines = wrapText(title, Math.max(20, Math.floor(width / 28)), 2);
  const subtitle = plan.thumbnail.subtitle;
  const titleSize = Math.max(30, Math.round(width * 0.045));
  const subtitleSize = Math.max(18, Math.round(width * 0.021));
  const lineHeight = Math.round(titleSize * 1.08);
  const blockHeight = titleLines.length * lineHeight + (subtitle ? subtitleSize + 18 : 0);
  const startY = height - 56 - blockHeight + titleSize;
  const titleNodes = titleLines.map((line, index) => `<text x="56" y="${startY + index * lineHeight}" fill="#ffffff" font-family="sans-serif" font-size="${titleSize}" font-weight="700">${escapeXml(line)}</text>`).join('');
  const subtitleY = startY + titleLines.length * lineHeight + 4;
  const subtitleNode = subtitle
    ? `<text x="58" y="${subtitleY}" fill="#d6dae5" font-family="sans-serif" font-size="${subtitleSize}" font-weight="500">${escapeXml(subtitle)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.82"/></linearGradient></defs><rect width="100%" height="100%" fill="${plan.thumbnail.background}"/><image width="${width}" height="${height}" href="data:image/png;base64,${frame.toString('base64')}"/><rect y="${Math.round(height * 0.43)}" width="${width}" height="${Math.round(height * 0.57)}" fill="url(#shade)"/>${titleNodes}${subtitleNode}</svg>`;
}

async function extractThumbnailFrame(
  tutorial: ResolvedTutorial,
  target: string,
  options: TutorialBuildOptions,
): Promise<void> {
  const runner = options.processRunner ?? runProcess;
  const thumbnail = tutorial.plan.thumbnail;
  const size = `${thumbnail.width}:${thumbnail.height}`;
  const filter = thumbnail.fit === 'cover'
    ? `scale=${size}:force_original_aspect_ratio=increase,crop=${size},setsar=1`
    : `scale=${size}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${size}:(ow-iw)/2:(oh-ih)/2:color=${thumbnail.background},setsar=1`;
  let result;
  try {
    result = await runner(options.ffmpegPath ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', (thumbnail.atMs / 1_000).toFixed(3),
      '-i', tutorial.sourcePath,
      '-frames:v', '1',
      '-vf', filter,
      '-an', '-map_metadata', '-1',
      target,
    ]);
  } catch (error) {
    throw new RendererError('FFMPEG_NOT_FOUND', `FFmpeg could not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (result.exitCode === null) throw new RendererError('FFMPEG_NOT_FOUND', 'FFmpeg is required for tutorial thumbnail generation.');
  if (result.exitCode !== 0) throw new RendererError('THUMBNAIL_FAILED', `FFmpeg thumbnail extraction failed (exit ${result.exitCode}): ${result.stderr || 'no diagnostic output'}`);
}

async function configuredMediaDirectory(root: string): Promise<string> {
  const configPath = path.join(root, '.demoweave', 'config.json');
  if (!(await pathExists(configPath))) return await resolveOutputInsideRoot(root, 'docs-media');
  let config: any;
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    throw new RendererError('INVALID_CONFIG', `DemoWeave config is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (config?.schemaVersion !== 1 || typeof config?.mediaDir !== 'string' || !config.mediaDir.trim()) {
    throw new RendererError('INVALID_CONFIG', 'DemoWeave config requires schemaVersion 1 and a non-empty project-relative mediaDir.');
  }
  return await resolveOutputInsideRoot(root, config.mediaDir);
}

function createEvidence(
  tutorial: ResolvedTutorial,
  id: string,
  label: string,
  kind: Evidence['kind'],
  format: NonNullable<Evidence['format']>,
  mimeType: string,
  target: string,
  bytes: Buffer,
): Evidence {
  return {
    schemaVersion: 1,
    id,
    kind,
    status: 'available',
    label,
    format,
    path: repositoryPath(tutorial.root, target),
    artifactHash: sha256(bytes),
    mimeType,
    producer: { kind: 'renderer', id: 'tutorial', version: rendererVersion },
    provenance: {
      sources: [{ path: tutorial.projectPlanPath, role: 'config', hash: tutorial.planHash }],
    },
    derivedFrom: [tutorial.sourceEvidence.id],
  };
}

export async function buildTutorial(reference: string, options: TutorialBuildOptions = {}): Promise<TutorialBuildResult> {
  const tutorial = await resolveTutorial(reference, options.projectRoot ?? '.');
  const probe = await probeTutorialVideo(tutorial.sourcePath, {
    ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
    ...(options.processRunner ? { processRunner: options.processRunner } : {}),
  });
  validateTiming(tutorial.plan, probe.durationMs);

  const mediaRoot = await configuredMediaDirectory(tutorial.root);
  const outputDirectory = options.outputDirectory
    ? await resolveOutputInsideRoot(tutorial.root, options.outputDirectory)
    : await resolveOutputInsideRoot(tutorial.root, repositoryPath(tutorial.root, path.join(mediaRoot, 'tutorials', tutorial.plan.id)));
  const videoPath = path.join(outputDirectory, `${tutorial.plan.id}.mp4`);
  const thumbnailPath = path.join(outputDirectory, `${tutorial.plan.id}-thumbnail.png`);
  const srtPath = path.join(outputDirectory, `${tutorial.plan.id}.srt`);
  const vttPath = path.join(outputDirectory, `${tutorial.plan.id}.vtt`);
  const chaptersPath = path.join(outputDirectory, `${tutorial.plan.id}-chapters.txt`);
  const descriptionPath = path.join(outputDirectory, `${tutorial.plan.id}-description.txt`);
  const metadataPath = path.join(outputDirectory, `${tutorial.plan.id}-youtube.json`);

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-tutorial-'));
  try {
    const rawFramePath = path.join(temporaryDirectory, 'thumbnail-frame.png');
    await extractThumbnailFrame(tutorial, rawFramePath, options);
    const rawFrame = await fs.readFile(rawFramePath).catch((error) => {
      throw new RendererError('THUMBNAIL_FAILED', 'FFmpeg reported success but did not produce a thumbnail frame.', { cause: error });
    });
    const rasterizer = options.rasterizer ?? new ResvgRasterizer();
    const thumbnailBytes = rasterizer.rasterize(thumbnailSvg(rawFrame, tutorial.plan)).png;
    const videoBytes = await fs.readFile(tutorial.sourcePath);
    const srt = renderSrt(tutorial.plan.captions);
    const vtt = renderVtt(tutorial.plan.captions);
    const chapters = renderChapters(tutorial.plan);
    const description = renderDescription(tutorial.plan);

    const metadata = {
      schemaVersion: 1,
      id: tutorial.plan.id,
      title: tutorial.plan.metadata.title,
      description,
      language: tutorial.plan.metadata.language,
      tags: tutorial.plan.metadata.tags ?? [],
      sourceEvidenceId: tutorial.sourceEvidence.id,
      files: {
        video: repositoryPath(tutorial.root, videoPath),
        thumbnail: repositoryPath(tutorial.root, thumbnailPath),
        captionsSrt: repositoryPath(tutorial.root, srtPath),
        captionsVtt: repositoryPath(tutorial.root, vttPath),
        chapters: repositoryPath(tutorial.root, chaptersPath),
        description: repositoryPath(tutorial.root, descriptionPath),
      },
      video: probe,
    };
    const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;

    await writeFileAtomic(videoPath, videoBytes);
    await writeFileAtomic(thumbnailPath, thumbnailBytes);
    await writeFileAtomic(srtPath, srt);
    await writeFileAtomic(vttPath, vtt);
    await writeFileAtomic(chaptersPath, chapters);
    await writeFileAtomic(descriptionPath, description);
    await writeFileAtomic(metadataPath, metadataText);

    const outputs = [
      createEvidence(tutorial, `${tutorial.plan.id}-video`, `${tutorial.plan.id} tutorial video`, 'recording', 'mp4', 'video/mp4', videoPath, videoBytes),
      createEvidence(tutorial, `${tutorial.plan.id}-thumbnail`, `${tutorial.plan.id} tutorial thumbnail`, 'image', 'png', 'image/png', thumbnailPath, thumbnailBytes),
      createEvidence(tutorial, `${tutorial.plan.id}-captions-srt`, `${tutorial.plan.id} tutorial captions (SRT)`, 'text', 'srt', 'application/x-subrip', srtPath, Buffer.from(srt)),
      createEvidence(tutorial, `${tutorial.plan.id}-captions-vtt`, `${tutorial.plan.id} tutorial captions (WebVTT)`, 'text', 'vtt', 'text/vtt', vttPath, Buffer.from(vtt)),
      createEvidence(tutorial, `${tutorial.plan.id}-chapters`, `${tutorial.plan.id} tutorial chapters`, 'text', 'txt', 'text/plain', chaptersPath, Buffer.from(chapters)),
      createEvidence(tutorial, `${tutorial.plan.id}-description`, `${tutorial.plan.id} tutorial description`, 'text', 'txt', 'text/plain', descriptionPath, Buffer.from(description)),
      createEvidence(tutorial, `${tutorial.plan.id}-metadata`, `${tutorial.plan.id} tutorial metadata`, 'result', 'json', 'application/json', metadataPath, Buffer.from(metadataText)),
    ];
    const outputIds = new Set(outputs.map((item) => item.id));
    const manifest = normalizeManifest({
      ...tutorial.manifest,
      evidence: [...tutorial.manifest.evidence.filter((item) => !outputIds.has(item.id)), ...outputs],
    });
    await writeFileAtomic(tutorial.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    return {
      id: tutorial.plan.id,
      sourceEvidenceId: tutorial.sourceEvidence.id,
      width: probe.width,
      height: probe.height,
      durationMs: probe.durationMs,
      outputDirectory,
      videoPath,
      thumbnailPath,
      srtPath,
      vttPath,
      chaptersPath,
      descriptionPath,
      metadataPath,
      evidenceIds: outputs.map((item) => item.id),
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
