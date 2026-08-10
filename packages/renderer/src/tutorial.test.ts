import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ManifestSchema, TutorialPlanSchema, type TutorialPlan } from '@demoweave/core';
import {
  buildTutorial,
  probeTutorialVideo,
  renderChapters,
  renderDescription,
  renderSrt,
  renderVtt,
  RendererError,
  resolveTutorial,
  type ProcessRunner,
  type Rasterizer,
} from './index.js';

const repository = path.resolve(process.cwd(), '../..');

function plan(): TutorialPlan {
  return TutorialPlanSchema.parse({
    schemaVersion: 1,
    id: 'proof-tutorial',
    video: { evidenceId: 'proof-video' },
    metadata: {
      title: 'DemoWeave proof',
      description: 'Runtime evidence, packaged deterministically.',
      language: 'en-US',
      tags: ['documentation', 'developer-tools'],
    },
    thumbnail: {
      atMs: 2500,
      width: 1280,
      height: 720,
      fit: 'cover',
      background: '#0b0d14',
      title: 'DemoWeave',
      subtitle: 'Evidence-driven documentation',
    },
    captions: [
      { id: 'intro', startMs: 0, endMs: 2200, text: 'Runtime evidence grounds the documentation.' },
      { id: 'compose', startMs: 2300, endMs: 4900, text: 'Terminal motion and a static browser screenshot are composed honestly.' },
    ],
    chapters: [{ startMs: 0, title: 'Evidence-driven proof' }],
  });
}

async function fixture(context: test.TestContext, tutorialPlan = plan()): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-tutorial-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'tutorials'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.copyFile(path.join(repository, 'docs-media', 'terminal-web-proof.mp4'), path.join(root, 'media', 'proof.mp4'));
  await fs.writeFile(path.join(root, '.demoweave', 'tutorials', `${tutorialPlan.id}.json`), `${JSON.stringify(tutorialPlan, null, 2)}\n`);
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), `${JSON.stringify({ schemaVersion: 1, mediaDir: 'output' }, null, 2)}\n`);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: 'preserved', path: '.demoweave/flows/preserved.json', surfaceId: 'terminal-preserved' }],
    evidence: [{
      schemaVersion: 1,
      id: 'proof-video',
      kind: 'recording',
      status: 'available',
      format: 'mp4',
      path: 'media/proof.mp4',
      provenance: { sources: [] },
    }],
  }, null, 2)}\n`);
  return root;
}

test('renders SRT, WebVTT, chapters, and upload description deterministically', () => {
  const tutorial = plan();
  assert.equal(renderSrt(tutorial.captions), '1\n00:00:00,000 --> 00:00:02,200\nRuntime evidence grounds the documentation.\n\n2\n00:00:02,300 --> 00:00:04,900\nTerminal motion and a static browser screenshot are composed honestly.\n');
  assert.equal(renderVtt(tutorial.captions), 'WEBVTT\n\nintro\n00:00:00.000 --> 00:00:02.200\nRuntime evidence grounds the documentation.\n\ncompose\n00:00:02.300 --> 00:00:04.900\nTerminal motion and a static browser screenshot are composed honestly.\n');
  assert.equal(renderChapters(tutorial), '0:00 Evidence-driven proof\n');
  assert.equal(renderDescription(tutorial), 'Runtime evidence, packaged deterministically.\n\nChapters\n0:00 Evidence-driven proof\n');
});

test('resolves only safe project-local MP4 Evidence', async (context) => {
  const root = await fixture(context);
  const resolved = await resolveTutorial('proof-tutorial', root);
  assert.equal(resolved.sourceEvidence.id, 'proof-video');
  assert.equal(resolved.projectPlanPath, '.demoweave/tutorials/proof-tutorial.json');
  assert.match(resolved.planHash, /^sha256:[0-9a-f]{64}$/);

  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.evidence[0].format = 'gif';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(resolveTutorial('proof-tutorial', root), (error: unknown) => error instanceof RendererError && error.code === 'WRONG_EVIDENCE_FORMAT');

  await assert.rejects(resolveTutorial('../escape', root), (error: unknown) => error instanceof RendererError && error.code === 'UNSAFE_TUTORIAL_PATH');
});

test('rejects tutorial source symlink escapes when the platform permits symlinks', async (context) => {
  const root = await fixture(context);
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-tutorial-outside-'));
  context.after(() => fs.rm(outsideDir, { recursive: true, force: true }));
  const outside = path.join(outsideDir, 'outside.mp4');
  await fs.copyFile(path.join(repository, 'docs-media', 'terminal-web-proof.mp4'), outside);
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.evidence[0].path = 'media/link.mp4';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  try {
    await fs.rm(path.join(root, 'media', 'proof.mp4'));
    await fs.symlink(outside, path.join(root, 'media', 'link.mp4'));
    await assert.rejects(resolveTutorial('proof-tutorial', root), (error: unknown) => error instanceof RendererError && error.code === 'UNSAFE_SOURCE_PATH');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
});

test('probes video dimensions/duration and reports missing or invalid ffprobe', async () => {
  const success: ProcessRunner = async () => ({
    exitCode: 0,
    stdout: JSON.stringify({ streams: [{ width: 1920, height: 720 }], format: { duration: '5.000000' } }),
    stderr: '',
  });
  assert.deepEqual(await probeTutorialVideo('proof.mp4', { processRunner: success }), { width: 1920, height: 720, durationMs: 5000 });

  const missing: ProcessRunner = async () => ({ exitCode: null, stdout: '', stderr: '' });
  await assert.rejects(probeTutorialVideo('proof.mp4', { processRunner: missing }), (error: unknown) => error instanceof RendererError && error.code === 'FFPROBE_NOT_FOUND');

  const invalid: ProcessRunner = async () => ({ exitCode: 0, stdout: '{}', stderr: '' });
  await assert.rejects(probeTutorialVideo('proof.mp4', { processRunner: invalid }), (error: unknown) => error instanceof RendererError && error.code === 'VIDEO_PROBE_FAILED');
});

test('builds a tutorial package and records all outputs with provenance', async (context) => {
  const root = await fixture(context);
  const runner: ProcessRunner = async (executable, args) => {
    if (path.basename(executable).toLowerCase().startsWith('ffprobe')) {
      return { exitCode: 0, stdout: JSON.stringify({ streams: [{ width: 1920, height: 720 }], format: { duration: '5' } }), stderr: '' };
    }
    await fs.writeFile(args.at(-1)!, Buffer.from('frame'));
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const rasterizer: Rasterizer = {
    rasterize: () => ({ png: Buffer.from('thumbnail-png'), width: 1280, height: 720 }),
  };
  const result = await buildTutorial('proof-tutorial', { projectRoot: root, processRunner: runner, rasterizer });
  assert.equal(result.sourceEvidenceId, 'proof-video');
  assert.equal(result.durationMs, 5000);
  assert.equal(result.evidenceIds.length, 7);
  assert.equal(await fs.readFile(result.videoPath).then((bytes) => bytes.length > 0), true);
  assert.match(await fs.readFile(result.srtPath, 'utf8'), /00:00:02,300/);
  assert.match(await fs.readFile(result.vttPath, 'utf8'), /^WEBVTT/);
  assert.match(await fs.readFile(result.descriptionPath, 'utf8'), /Chapters\n0:00 Evidence-driven proof/);

  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8')));
  assert.deepEqual(manifest.flows, [{ id: 'preserved', path: '.demoweave/flows/preserved.json', surfaceId: 'terminal-preserved' }]);
  for (const id of result.evidenceIds) {
    const evidence = manifest.evidence.find((item) => item.id === id);
    assert.equal(evidence?.producer?.id, 'tutorial');
    assert.deepEqual(evidence?.derivedFrom, ['proof-video']);
    assert.match(evidence?.artifactHash ?? '', /^sha256:[0-9a-f]{64}$/);
  }
  const thumbnail = manifest.evidence.find((item) => item.id === 'proof-tutorial-thumbnail');
  assert.deepEqual(thumbnail?.provenance.sources.map((source) => source.path), ['.demoweave/tutorials/proof-tutorial.json']);
});

test('rejects out-of-range caption/thumbnail/chapter timing before writing a package', async (context) => {
  const bad = plan();
  bad.captions[1]!.endMs = 5500;
  const root = await fixture(context, bad);
  const runner: ProcessRunner = async (executable) => path.basename(executable).toLowerCase().startsWith('ffprobe')
    ? { exitCode: 0, stdout: JSON.stringify({ streams: [{ width: 1920, height: 720 }], format: { duration: '5' } }), stderr: '' }
    : { exitCode: 0, stdout: '', stderr: '' };
  await assert.rejects(buildTutorial('proof-tutorial', { projectRoot: root, processRunner: runner }),
    (error: unknown) => error instanceof RendererError && error.code === 'TUTORIAL_TIMING_INVALID');
  assert.equal(await fs.stat(path.join(root, 'output')).then(() => true, () => false), false);
});

test('real ffprobe/FFmpeg smoke builds a package when available', async (context) => {
  try {
    const probe = await probeTutorialVideo(path.join(repository, 'docs-media', 'terminal-web-proof.mp4'));
    assert.equal(probe.width, 1920);
    assert.equal(probe.height, 720);
    assert.ok(probe.durationMs >= 4900 && probe.durationMs <= 5100);
  } catch (error) {
    if (error instanceof RendererError && error.code === 'FFPROBE_NOT_FOUND') {
      context.skip('ffprobe is not available on PATH');
      return;
    }
    throw error;
  }
  const root = await fixture(context);
  const result = await buildTutorial('proof-tutorial', { projectRoot: root });
  assert.ok((await fs.stat(result.thumbnailPath)).size > 0);
  assert.ok((await fs.stat(result.videoPath)).size > 0);
});
