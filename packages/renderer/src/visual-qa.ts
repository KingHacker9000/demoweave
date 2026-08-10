import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ManifestSchema,
  TimelinePlanSchema,
  TutorialPlanSchema,
  VisualQAPacketSchema,
  VisualQAReportSchema,
  normalizeManifest,
  type Evidence,
  type Manifest,
  type VisualQAPacket,
  type VisualQAReport,
  type VisualQASampleContext,
  type VisualQASignal,
} from '@demoweave/core';
import { inspectMediaBytes } from './compositor.js';
import { RendererError, runProcess, type ProcessRunner } from './ffmpeg.js';
import { ResvgRasterizer, type Rasterizer } from './rasterizer.js';
import { probeTutorialVideo } from './tutorial.js';

export type PrepareVisualQaOptions = {
  projectRoot?: string;
  id?: string;
  sampleCount?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  processRunner?: ProcessRunner;
  rasterizer?: Rasterizer;
};

export type PrepareVisualQaResult = {
  id: string;
  packet: VisualQAPacket;
  packetHash: `sha256:${string}`;
  packetPath: string;
  reportPath: string;
  contactSheetPath: string;
  reportCreated: boolean;
};

export type FinalizeVisualQaOptions = {
  projectRoot?: string;
};

export type FinalizeVisualQaResult = {
  report: VisualQAReport;
  evidenceId: string;
  evidencePath: string;
  verdict: 'pass' | 'needs-changes';
};

type ResolvedSource = {
  root: string;
  manifestPath: string;
  manifest: Manifest;
  evidence: Evidence;
  path: string;
  projectPath: string;
  bytes: Buffer;
  hash: `sha256:${string}`;
  format: 'png' | 'gif' | 'mp4';
  width: number;
  height: number;
  durationMs?: number;
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
    throw new RendererError('QA_SOURCE_NOT_FOUND', `Visual QA source does not exist: ${relative}`, { cause: error });
  }
  if (!insideRoot(realRoot, realTarget)) throw new RendererError(code, `Path resolves through a symlink outside the project root: ${relative}`);
  if (!(await fs.stat(realTarget)).isFile()) throw new RendererError('QA_SOURCE_NOT_FOUND', `Visual QA source is not a file: ${relative}`);
  return realTarget;
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

async function resolveVisualQaSource(evidenceId: string, projectRoot: string, options: PrepareVisualQaOptions = {}): Promise<ResolvedSource> {
  const root = await fs.realpath(path.resolve(projectRoot));
  const { path: manifestPath, manifest } = await readManifest(root);
  const evidence = manifest.evidence.find((item) => item.id === evidenceId);
  if (!evidence) throw new RendererError('EVIDENCE_NOT_FOUND', `Visual QA references missing Evidence: ${evidenceId}`);
  if (evidence.status !== 'available') throw new RendererError('QA_SOURCE_UNAVAILABLE', `Visual QA requires available Evidence; ${evidenceId} has status ${evidence.status}.`);
  if (!evidence.path || !evidence.format || !['png', 'gif', 'mp4'].includes(evidence.format)) {
    throw new RendererError('QA_UNSUPPORTED_FORMAT', `Visual QA supports available PNG, GIF, or MP4 Evidence; ${evidenceId} is ${evidence.format ?? 'unformatted'}.`);
  }
  const sourcePath = await resolveExistingInsideRoot(root, evidence.path, 'UNSAFE_SOURCE_PATH');
  const bytes = await fs.readFile(sourcePath);
  const hash = sha256(bytes);
  if (evidence.artifactHash && evidence.artifactHash !== hash) {
    throw new RendererError('QA_SOURCE_HASH_MISMATCH', `Evidence ${evidenceId} artifact hash does not match the current file. Run freshness/update before reviewing it.`);
  }

  if (evidence.format === 'mp4') {
    const probe = await probeTutorialVideo(sourcePath, {
      ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
      ...(options.processRunner ? { processRunner: options.processRunner } : {}),
    });
    return { root, manifestPath, manifest, evidence, path: sourcePath, projectPath: evidence.path, bytes, hash, format: 'mp4', ...probe };
  }

  const media = inspectMediaBytes(bytes);
  if (media.format !== evidence.format) throw new RendererError('QA_SOURCE_FORMAT_MISMATCH', `Evidence ${evidenceId} declares ${evidence.format} but the artifact bytes are ${media.format}.`);
  return {
    root,
    manifestPath,
    manifest,
    evidence,
    path: sourcePath,
    projectPath: evidence.path,
    bytes,
    hash,
    format: media.format,
    width: media.width,
    height: media.height,
    ...(media.durationMs ? { durationMs: media.durationMs } : {}),
  };
}

function uniformSampleTimes(format: 'png' | 'gif' | 'mp4', durationMs: number | undefined, requestedCount: number): number[] {
  if (format === 'png') return [0];
  const duration = durationMs ?? 1;
  const last = Math.max(0, duration - Math.min(50, Math.max(1, Math.floor(duration / 100))));
  if (requestedCount === 1) return [Math.floor(last / 2)];
  const times = Array.from({ length: requestedCount }, (_, index) => Math.round((last * index) / (requestedCount - 1)));
  return [...new Set(times)].sort((a, b) => a - b);
}

async function extractFrame(source: ResolvedSource, atMs: number, target: string, options: PrepareVisualQaOptions): Promise<void> {
  if (source.format === 'png') {
    await writeFileAtomic(target, source.bytes);
    return;
  }
  const runner = options.processRunner ?? runProcess;
  let result;
  try {
    result = await runner(options.ffmpegPath ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', (atMs / 1000).toFixed(3),
      '-i', source.path,
      '-frames:v', '1',
      '-an', '-map_metadata', '-1',
      target,
    ]);
  } catch (error) {
    throw new RendererError('FFMPEG_NOT_FOUND', `FFmpeg could not start while sampling visual QA frames: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (result.exitCode === null) throw new RendererError('FFMPEG_NOT_FOUND', 'FFmpeg is required to sample GIF/MP4 visual QA frames.');
  if (result.exitCode !== 0) throw new RendererError('QA_FRAME_EXTRACTION_FAILED', `FFmpeg frame extraction failed (exit ${result.exitCode}): ${result.stderr || 'no diagnostic output'}`);
  if (!(await pathExists(target))) throw new RendererError('QA_FRAME_EXTRACTION_FAILED', `FFmpeg did not create the expected sample frame at ${atMs}ms.`);
}

async function contextForSample(source: ResolvedSource, atMs: number): Promise<VisualQASampleContext | undefined> {
  const sceneIds: string[] = [];
  const captionIds: string[] = [];
  for (const dependency of source.evidence.provenance.sources) {
    if (!dependency.path.endsWith('.json')) continue;
    let input: unknown;
    try {
      const file = await resolveExistingInsideRoot(source.root, dependency.path, 'UNSAFE_SOURCE_PATH');
      input = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      continue;
    }
    const timeline = TimelinePlanSchema.safeParse(input);
    if (timeline.success) {
      let cursor = 0;
      for (const scene of timeline.data.scenes) {
        const end = cursor + scene.durationMs;
        if (atMs >= cursor && atMs < end) sceneIds.push(scene.id);
        cursor = end;
      }
      continue;
    }
    const tutorial = TutorialPlanSchema.safeParse(input);
    if (tutorial.success) {
      for (const cue of tutorial.data.captions) if (atMs >= cue.startMs && atMs < cue.endMs) captionIds.push(cue.id);
    }
  }
  if (!sceneIds.length && !captionIds.length) return undefined;
  return {
    ...(sceneIds.length ? { sceneIds: [...new Set(sceneIds)] } : {}),
    ...(captionIds.length ? { captionIds: [...new Set(captionIds)] } : {}),
  };
}

function parseVisualSignals(stderr: string, durationMs: number): VisualQASignal[] {
  const signals: Array<Omit<VisualQASignal, 'id'>> = [];
  const black = /black_start:([0-9.]+)\s+black_end:([0-9.]+)/g;
  for (const match of stderr.matchAll(black)) {
    const startMs = Math.max(0, Math.round(Number(match[1]) * 1000));
    const endMs = Math.min(durationMs, Math.round(Number(match[2]) * 1000));
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) signals.push({ kind: 'black-range', startMs, endMs });
  }

  let freezeStart: number | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/freeze_start:\s*([0-9.]+)/);
    if (start) {
      freezeStart = Math.max(0, Math.round(Number(start[1]) * 1000));
      continue;
    }
    const end = line.match(/freeze_end:\s*([0-9.]+)/);
    if (end && freezeStart !== undefined) {
      const endMs = Math.min(durationMs, Math.round(Number(end[1]) * 1000));
      if (endMs > freezeStart) signals.push({ kind: 'freeze-range', startMs: freezeStart, endMs });
      freezeStart = undefined;
    }
  }
  if (freezeStart !== undefined && durationMs > freezeStart) signals.push({ kind: 'freeze-range', startMs: freezeStart, endMs: durationMs });

  return signals
    .sort((a, b) => a.startMs - b.startMs || a.kind.localeCompare(b.kind))
    .map((signal, index) => ({ id: `${signal.kind === 'black-range' ? 'black' : 'freeze'}-${String(index + 1).padStart(3, '0')}`, ...signal }));
}

async function detectVisualSignals(source: ResolvedSource, options: PrepareVisualQaOptions): Promise<VisualQASignal[]> {
  if (source.format === 'png' || !source.durationMs) return [];
  const runner = options.processRunner ?? runProcess;
  try {
    const result = await runner(options.ffmpegPath ?? 'ffmpeg', [
      '-hide_banner', '-nostats', '-i', source.path,
      '-vf', 'blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.0001:d=1.0',
      '-an', '-f', 'null', '-',
    ]);
    if (result.exitCode !== 0) return [];
    return parseVisualSignals(result.stderr, source.durationMs);
  } catch {
    return [];
  }
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function contactSheetSvg(samples: Array<{ id: string; atMs: number; bytes: Buffer; width: number; height: number; context?: VisualQASampleContext }>): { svg: string; width: number; height: number } {
  const width = 1280;
  const padding = 28;
  const gap = 18;
  const columns = Math.min(3, samples.length);
  const cellWidth = Math.floor((width - padding * 2 - gap * (columns - 1)) / columns);
  const first = samples[0]!;
  const imageHeight = Math.max(100, Math.round(cellWidth * first.height / first.width));
  const labelHeight = 54;
  const rows = Math.ceil(samples.length / columns);
  const height = padding * 2 + rows * (imageHeight + labelHeight) + Math.max(0, rows - 1) * gap;
  const nodes = samples.map((sample, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = padding + column * (cellWidth + gap);
    const y = padding + row * (imageHeight + labelHeight + gap);
    const context = [
      ...(sample.context?.sceneIds?.map((id) => `scene:${id}`) ?? []),
      ...(sample.context?.captionIds?.map((id) => `caption:${id}`) ?? []),
    ].join(' · ');
    return `<g><rect x="${x}" y="${y}" width="${cellWidth}" height="${imageHeight + labelHeight}" rx="12" fill="#141821"/><image x="${x}" y="${y}" width="${cellWidth}" height="${imageHeight}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${sample.bytes.toString('base64')}"/><text x="${x + 12}" y="${y + imageHeight + 22}" fill="#f3f5f7" font-family="sans-serif" font-size="15" font-weight="700">${escapeXml(sample.id)} · ${(sample.atMs / 1000).toFixed(2)}s</text>${context ? `<text x="${x + 12}" y="${y + imageHeight + 43}" fill="#aeb6c4" font-family="sans-serif" font-size="12">${escapeXml(context)}</text>` : ''}</g>`;
  }).join('');
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#0b0d14"/>${nodes}</svg>`, width, height };
}

function packetHash(packet: VisualQAPacket): `sha256:${string}` {
  return sha256(JSON.stringify(packet));
}

function defaultReviewId(evidenceId: string): string {
  if (/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(evidenceId)) return `${evidenceId}-review`;
  const slug = evidenceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'evidence';
  const suffix = createHash('sha256').update(evidenceId).digest('hex').slice(0, 8);
  return `${slug}-${suffix}-review`;
}

export function hashVisualQaPacket(packet: VisualQAPacket): `sha256:${string}` {
  return packetHash(VisualQAPacketSchema.parse(packet));
}

export async function prepareVisualQa(evidenceId: string, options: PrepareVisualQaOptions = {}): Promise<PrepareVisualQaResult> {
  const sampleCount = options.sampleCount ?? 7;
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 20) throw new RendererError('INVALID_QA_SAMPLE_COUNT', 'Visual QA sampleCount must be an integer from 1 to 20.');
  const source = await resolveVisualQaSource(evidenceId, options.projectRoot ?? '.', options);
  const id = options.id ?? defaultReviewId(evidenceId);
  if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(id)) throw new RendererError('INVALID_QA_ID', `Visual QA id must be lowercase kebab-case: ${id}`);

  const cacheDir = path.join(source.root, '.demoweave', 'cache', 'qa', id);
  const reportDir = path.join(source.root, '.demoweave', 'qa', 'reports');
  const reportPath = path.join(reportDir, `${id}.json`);
  await fs.rm(cacheDir, { recursive: true, force: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });

  const sampleTimes = uniformSampleTimes(source.format, source.durationMs, sampleCount);
  const samples = [] as VisualQAPacket['sampling']['samples'];
  const contactSamples: Array<{ id: string; atMs: number; bytes: Buffer; width: number; height: number; context?: VisualQASampleContext }> = [];
  for (let index = 0; index < sampleTimes.length; index += 1) {
    const atMs = sampleTimes[index]!;
    const sampleId = `frame-${String(index + 1).padStart(3, '0')}`;
    const target = path.join(cacheDir, `${sampleId}.png`);
    await extractFrame(source, atMs, target, options);
    const bytes = await fs.readFile(target);
    const media = inspectMediaBytes(bytes);
    if (media.format !== 'png') throw new RendererError('QA_FRAME_INVALID', `Visual QA sample ${sampleId} is not a valid PNG frame.`);
    const context = await contextForSample(source, atMs);
    samples.push({
      id: sampleId,
      atMs,
      path: repositoryPath(source.root, target),
      artifactHash: sha256(bytes),
      width: media.width,
      height: media.height,
      ...(context ? { context } : {}),
    });
    contactSamples.push({ id: sampleId, atMs, bytes, width: media.width, height: media.height, ...(context ? { context } : {}) });
  }

  const contact = contactSheetSvg(contactSamples);
  const rasterizer = options.rasterizer ?? new ResvgRasterizer();
  const contactBytes = rasterizer.rasterize(contact.svg).png;
  const contactPath = path.join(cacheDir, 'contact-sheet.png');
  await writeFileAtomic(contactPath, contactBytes);
  const signals = await detectVisualSignals(source, options);

  const packet = VisualQAPacketSchema.parse({
    schemaVersion: 1,
    id,
    source: {
      evidenceId: source.evidence.id,
      path: source.projectPath,
      format: source.format,
      artifactHash: source.hash,
      width: source.width,
      height: source.height,
      ...(source.durationMs ? { durationMs: source.durationMs } : {}),
    },
    sampling: { strategy: 'uniform', requestedCount: sampleCount, samples },
    contactSheet: {
      path: repositoryPath(source.root, contactPath),
      artifactHash: sha256(contactBytes),
      width: contact.width,
      height: contact.height,
    },
    signals,
  });
  const hash = packetHash(packet);
  const packetPath = path.join(cacheDir, 'packet.json');
  await writeFileAtomic(packetPath, `${JSON.stringify(packet, null, 2)}\n`);

  let reportCreated = false;
  if (!(await pathExists(reportPath))) {
    const draft = VisualQAReportSchema.parse({
      schemaVersion: 1,
      id,
      packetId: id,
      packetHash: hash,
      sourceEvidenceId: source.evidence.id,
      sourceArtifactHash: source.hash,
      verdict: 'pending',
      findings: [],
    });
    await writeFileAtomic(reportPath, `${JSON.stringify(draft, null, 2)}\n`);
    reportCreated = true;
  }

  return {
    id,
    packet,
    packetHash: hash,
    packetPath,
    reportPath,
    contactSheetPath: contactPath,
    reportCreated,
  };
}

async function resolveReportPath(reference: string, root: string): Promise<string> {
  if (unsafePortablePath(reference)) throw new RendererError('UNSAFE_QA_REPORT_PATH', `Visual QA report path must be project-relative: ${reference}`);
  const explicit = reference.includes('/') || reference.includes('\\') || reference.endsWith('.json');
  const relative = explicit ? reference : `.demoweave/qa/reports/${reference}.json`;
  return await resolveExistingInsideRoot(root, relative, 'UNSAFE_QA_REPORT_PATH');
}

export async function finalizeVisualQa(reference: string, options: FinalizeVisualQaOptions = {}): Promise<FinalizeVisualQaResult> {
  const root = await fs.realpath(path.resolve(options.projectRoot ?? '.'));
  const reportPath = await resolveReportPath(reference, root);
  let reportInput: unknown;
  try {
    reportInput = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  } catch (error) {
    throw new RendererError('INVALID_QA_REPORT', `Visual QA report is unreadable JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const parsedReport = VisualQAReportSchema.safeParse(reportInput);
  if (!parsedReport.success) throw new RendererError('INVALID_QA_REPORT', `VisualQAReport v1 is invalid: ${parsedReport.error.issues[0]?.message ?? 'unknown validation error'}`);
  const report = parsedReport.data;
  if (report.verdict === 'pending') throw new RendererError('QA_REVIEW_PENDING', 'Visual QA report is still pending. An agent must inspect the packet and set pass or needs-changes before finalization.');

  const packetPath = path.join(root, '.demoweave', 'cache', 'qa', report.packetId, 'packet.json');
  let packetInput: unknown;
  try {
    packetInput = JSON.parse(await fs.readFile(packetPath, 'utf8'));
  } catch (error) {
    throw new RendererError('QA_PACKET_MISSING', `Prepared QA packet is missing. Run demoweave qa prepare ${report.sourceEvidenceId} again before finalizing.`, { cause: error });
  }
  const parsedPacket = VisualQAPacketSchema.safeParse(packetInput);
  if (!parsedPacket.success) throw new RendererError('INVALID_QA_PACKET', `VisualQAPacket v1 is invalid: ${parsedPacket.error.issues[0]?.message ?? 'unknown validation error'}`);
  const packet = parsedPacket.data;
  const hash = packetHash(packet);
  if (report.packetId !== packet.id || report.packetHash !== hash) throw new RendererError('QA_PACKET_MISMATCH', 'Visual QA report is not bound to the currently prepared packet. Re-review the regenerated packet.');
  if (report.sourceEvidenceId !== packet.source.evidenceId || report.sourceArtifactHash !== packet.source.artifactHash) {
    throw new RendererError('QA_SOURCE_MISMATCH', 'Visual QA report source binding does not match the prepared packet.');
  }

  const source = await resolveVisualQaSource(report.sourceEvidenceId, root);
  if (source.hash !== report.sourceArtifactHash) throw new RendererError('QA_SOURCE_CHANGED', 'Visual QA source bytes changed after review. Prepare and review a new packet.');

  const sampleIds = new Set(packet.sampling.samples.map((sample) => sample.id));
  for (const finding of report.findings) {
    if (finding.sampleId && !sampleIds.has(finding.sampleId)) throw new RendererError('QA_FINDING_SAMPLE_MISSING', `Finding ${finding.id} references unknown sample ${finding.sampleId}.`);
    if (source.durationMs !== undefined && finding.endMs !== undefined && finding.endMs > source.durationMs + 50) throw new RendererError('QA_FINDING_RANGE_INVALID', `Finding ${finding.id} extends beyond the source duration.`);
  }

  for (const sample of packet.sampling.samples) {
    const samplePath = await resolveExistingInsideRoot(root, sample.path, 'UNSAFE_QA_SAMPLE_PATH');
    const bytes = await fs.readFile(samplePath);
    if (sha256(bytes) !== sample.artifactHash) throw new RendererError('QA_SAMPLE_CHANGED', `Prepared sample ${sample.id} changed after the packet was generated.`);
  }
  const contactPath = await resolveExistingInsideRoot(root, packet.contactSheet.path, 'UNSAFE_QA_SAMPLE_PATH');
  if (sha256(await fs.readFile(contactPath)) !== packet.contactSheet.artifactHash) throw new RendererError('QA_SAMPLE_CHANGED', 'Visual QA contact sheet changed after the packet was generated.');

  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await writeFileAtomic(reportPath, reportBytes);
  const { path: manifestPath, manifest } = await readManifest(root);
  const evidenceId = `${report.id}-report`;
  if (evidenceId === report.sourceEvidenceId) throw new RendererError('QA_EVIDENCE_ID_COLLISION', `Visual QA report Evidence id ${evidenceId} collides with its source Evidence id.`);
  const evidence: Evidence = {
    schemaVersion: 1,
    id: evidenceId,
    kind: 'result',
    status: 'available',
    label: `${report.id} visual QA report (${report.verdict})`,
    format: 'json',
    path: repositoryPath(root, reportPath),
    artifactHash: sha256(reportBytes),
    mimeType: 'application/vnd.demoweave.visual-qa+json',
    producer: { kind: 'agent', id: 'visual-qa' },
    provenance: { sources: [] },
    derivedFrom: [report.sourceEvidenceId],
  };
  const next = normalizeManifest({
    ...manifest,
    evidence: [...manifest.evidence.filter((item) => item.id !== evidenceId), evidence],
  });
  await writeFileAtomic(manifestPath, `${JSON.stringify(next, null, 2)}\n`);

  return {
    report,
    evidenceId,
    evidencePath: repositoryPath(root, reportPath),
    verdict: report.verdict,
  };
}
