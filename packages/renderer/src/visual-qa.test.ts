import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ManifestSchema, VisualQAPacketSchema, VisualQAReportSchema } from '@demoweave/core';
import {
  RendererError,
  finalizeVisualQa,
  hashVisualQaPacket,
  prepareVisualQa,
  type ProcessRunner,
  type Rasterizer,
} from './index.js';

const repository = path.resolve(process.cwd(), '../..');

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function fixture(context: test.TestContext, format: 'png' | 'mp4' = 'png'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-visual-qa-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  const sourceName = format === 'png' ? 'source.png' : 'source.mp4';
  const sourceFrom = format === 'png'
    ? path.join(repository, 'docs-media', 'inspect-project-terminal.png')
    : path.join(repository, 'docs-media', 'terminal-web-proof.mp4');
  const sourcePath = path.join(root, 'media', sourceName);
  await fs.copyFile(sourceFrom, sourcePath);
  const bytes = await fs.readFile(sourcePath);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [{
      schemaVersion: 1,
      id: 'source-media',
      kind: format === 'png' ? 'image' : 'recording',
      status: 'available',
      format,
      path: `media/${sourceName}`,
      artifactHash: sha256(bytes),
      provenance: { sources: [] },
    }],
  }, null, 2)}\n`);
  return root;
}

test('prepares a single-frame PNG packet, contact sheet, and pending report', async (context) => {
  const root = await fixture(context, 'png');
  const result = await prepareVisualQa('source-media', { projectRoot: root, id: 'png-review', sampleCount: 7 });
  assert.equal(result.packet.source.format, 'png');
  assert.equal(result.packet.sampling.samples.length, 1);
  assert.equal(result.packet.sampling.samples[0]?.atMs, 0);
  assert.equal(result.reportCreated, true);
  assert.equal(VisualQAPacketSchema.safeParse(JSON.parse(await fs.readFile(result.packetPath, 'utf8'))).success, true);
  const report = VisualQAReportSchema.parse(JSON.parse(await fs.readFile(result.reportPath, 'utf8')));
  assert.equal(report.verdict, 'pending');
  assert.equal(report.packetHash, hashVisualQaPacket(result.packet));
  const contact = await fs.readFile(result.contactSheetPath);
  assert.deepEqual([...contact.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('prepare regenerates cache without overwriting an existing agent report', async (context) => {
  const root = await fixture(context, 'png');
  const first = await prepareVisualQa('source-media', { projectRoot: root, id: 'preserve-review' });
  const report = JSON.parse(await fs.readFile(first.reportPath, 'utf8'));
  report.findings = [{ id: 'agent-note', severity: 'info', category: 'other', message: 'Keep me.' }];
  await fs.writeFile(first.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const second = await prepareVisualQa('source-media', { projectRoot: root, id: 'preserve-review' });
  assert.equal(second.reportCreated, false);
  assert.match(await fs.readFile(second.reportPath, 'utf8'), /agent-note/);
});

test('prepares MP4 samples with timeline context and deterministic media signals', async (context) => {
  const root = await fixture(context, 'mp4');
  await fs.mkdir(path.join(root, '.demoweave', 'timelines'), { recursive: true });
  await fs.writeFile(path.join(root, '.demoweave', 'timelines', 'proof.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'proof',
    canvas: { width: 1920, height: 720, fps: 20, background: '#0b0d14' },
    scenes: [{
      id: 'scene-proof',
      durationMs: 5000,
      transition: 'cut',
      layout: { type: 'single', padding: 0 },
      panes: [{ id: 'pane', source: { kind: 'file', path: 'media/source.png' }, fit: 'contain' }],
    }],
  }));
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.evidence[0].provenance.sources = [{ path: '.demoweave/timelines/proof.json', role: 'config' }];
  await fs.writeFile(manifestPath, JSON.stringify(manifest));

  const samplePng = await fs.readFile(path.join(repository, 'docs-media', 'inspect-project-terminal.png'));
  const runner: ProcessRunner = async (executable, args) => {
    if (path.basename(executable).toLowerCase().startsWith('ffprobe')) {
      return { exitCode: 0, stdout: JSON.stringify({ streams: [{ width: 1920, height: 720 }], format: { duration: '5' } }), stderr: '' };
    }
    if (args.includes('-frames:v')) {
      await fs.writeFile(args.at(-1)!, samplePng);
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    return {
      exitCode: 0,
      stdout: '',
      stderr: '[blackdetect @ x] black_start:0.5 black_end:1.1 black_duration:0.6\n[freezedetect @ x] lavfi.freezedetect.freeze_start: 3\n[freezedetect @ x] lavfi.freezedetect.freeze_end: 4.25',
    };
  };
  const rasterizer: Rasterizer = { rasterize: () => ({ png: samplePng, width: 1280, height: 720 }) };
  const result = await prepareVisualQa('source-media', { projectRoot: root, id: 'mp4-review', sampleCount: 3, processRunner: runner, rasterizer });
  assert.equal(result.packet.sampling.samples.length, 3);
  assert.ok(result.packet.sampling.samples.every((sample) => sample.context?.sceneIds?.includes('scene-proof')));
  assert.deepEqual(result.packet.signals.map((signal) => signal.kind), ['black-range', 'freeze-range']);
});

test('finalizes an agent-reviewed report into derived result Evidence', async (context) => {
  const root = await fixture(context, 'png');
  const prepared = await prepareVisualQa('source-media', { projectRoot: root, id: 'final-review' });
  const report = VisualQAReportSchema.parse(JSON.parse(await fs.readFile(prepared.reportPath, 'utf8')));
  report.verdict = 'pass';
  report.findings = [{ id: 'static-note', severity: 'info', category: 'other', message: 'This is intentionally a static screenshot.', sampleId: 'frame-001' }];
  await fs.writeFile(prepared.reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const result = await finalizeVisualQa('final-review', { projectRoot: root });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.evidenceId, 'final-review-report');
  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8')));
  const evidence = manifest.evidence.find((item) => item.id === result.evidenceId);
  assert.equal(evidence?.producer?.kind, 'agent');
  assert.equal(evidence?.producer?.id, 'visual-qa');
  assert.deepEqual(evidence?.derivedFrom, ['source-media']);
  assert.equal(evidence?.format, 'json');
});

test('finalize refuses pending reports, changed source bytes, and changed samples', async (context) => {
  const pendingRoot = await fixture(context, 'png');
  await prepareVisualQa('source-media', { projectRoot: pendingRoot, id: 'pending-review' });
  await assert.rejects(finalizeVisualQa('pending-review', { projectRoot: pendingRoot }), (error: unknown) => error instanceof RendererError && error.code === 'QA_REVIEW_PENDING');

  const changedRoot = await fixture(context, 'png');
  const changed = await prepareVisualQa('source-media', { projectRoot: changedRoot, id: 'changed-review' });
  const changedReport = JSON.parse(await fs.readFile(changed.reportPath, 'utf8'));
  changedReport.verdict = 'pass';
  await fs.writeFile(changed.reportPath, JSON.stringify(changedReport));
  await fs.appendFile(path.join(changedRoot, 'media', 'source.png'), Buffer.from('changed'));
  await assert.rejects(finalizeVisualQa('changed-review', { projectRoot: changedRoot }), (error: unknown) => error instanceof RendererError && (error.code === 'QA_SOURCE_HASH_MISMATCH' || error.code === 'QA_SOURCE_CHANGED'));

  const sampleRoot = await fixture(context, 'png');
  const sample = await prepareVisualQa('source-media', { projectRoot: sampleRoot, id: 'sample-review' });
  const sampleReport = JSON.parse(await fs.readFile(sample.reportPath, 'utf8'));
  sampleReport.verdict = 'pass';
  await fs.writeFile(sample.reportPath, JSON.stringify(sampleReport));
  await fs.appendFile(path.join(sampleRoot, sample.packet.sampling.samples[0]!.path), Buffer.from('changed'));
  await assert.rejects(finalizeVisualQa('sample-review', { projectRoot: sampleRoot }), (error: unknown) => error instanceof RendererError && error.code === 'QA_SAMPLE_CHANGED');
});

test('real FFmpeg/ffprobe visual QA smoke samples MP4 Evidence when available', async (context) => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  const ffprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (ffmpeg.status !== 0 || ffprobe.status !== 0) {
    context.skip('ffmpeg/ffprobe are not available on PATH');
    return;
  }
  const root = await fixture(context, 'mp4');
  const result = await prepareVisualQa('source-media', { projectRoot: root, id: 'real-review', sampleCount: 3 });
  assert.equal(result.packet.source.width, 1920);
  assert.equal(result.packet.source.height, 720);
  assert.ok((result.packet.source.durationMs ?? 0) >= 4900 && (result.packet.source.durationMs ?? 0) <= 5100);
  assert.equal(result.packet.sampling.samples.length, 3);
  assert.ok((await fs.stat(result.contactSheetPath)).size > 0);
});
