import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ManifestSchema, TimelinePlanSchema, type TimelinePlan } from '@demoweave/core';
import {
  compileCompositionArguments,
  compileLayout,
  composeTimeline,
  ffmpegVersion,
  inspectMediaBytes,
  RendererError,
  resolveTimeline,
  type ProcessRunner,
} from './index.js';

const repository = path.resolve(process.cwd(), '../..');

function singlePlan(source: unknown = { kind: 'evidence', evidenceId: 'terminal-gif' }): TimelinePlan {
  return TimelinePlanSchema.parse({
    schemaVersion: 1,
    id: 'proof',
    canvas: { width: 640, height: 360, fps: 12, background: '#0b0d14' },
    scenes: [{
      id: 'single',
      durationMs: 1000,
      layout: { type: 'single', padding: 20 },
      panes: [{ id: 'media', source, fit: 'contain' }],
    }],
  });
}

async function projectFixture(context: test.TestContext, plan: TimelinePlan = singlePlan()): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-compositor-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'timelines'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.mkdir(path.join(root, 'fixtures'), { recursive: true });
  await fs.copyFile(path.join(repository, 'docs-media', 'inspect-project-terminal.gif'), path.join(root, 'media', 'terminal.gif'));
  await fs.copyFile(path.join(repository, 'fixtures', 'web', '.demoweave', 'evidence', 'artifacts', 'create-project-result.png'), path.join(root, 'fixtures', 'browser.png'));
  await fs.writeFile(path.join(root, '.demoweave', 'timelines', `${plan.id}.json`), `${JSON.stringify(plan, null, 2)}\n`);
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), `${JSON.stringify({ schemaVersion: 1, mediaDir: 'output' }, null, 2)}\n`);
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: 'preserved', path: '.demoweave/flows/preserved.json', surfaceId: 'terminal-preserved' }],
    evidence: [{
      schemaVersion: 1,
      id: 'terminal-gif',
      kind: 'recording',
      status: 'available',
      format: 'gif',
      path: 'media/terminal.gif',
      provenance: { sources: [] },
    }],
  }, null, 2)}\n`);
  return root;
}

test('inspects real PNG and animated GIF dimensions and timing', async () => {
  const png = inspectMediaBytes(await fs.readFile(path.join(repository, 'docs-media', 'inspect-project-terminal.png')));
  const gif = inspectMediaBytes(await fs.readFile(path.join(repository, 'docs-media', 'inspect-project-terminal.gif')));
  assert.deepEqual(png, { format: 'png', width: 1020, height: 486 });
  assert.equal(gif.format, 'gif');
  assert.equal(gif.width, 1020);
  assert.equal(gif.height, 486);
  assert.ok((gif.frameCount ?? 0) > 1);
  assert.ok((gif.durationMs ?? 0) >= 4_900 && (gif.durationMs ?? 0) <= 5_100);
});

test('normalizes Windows extended paths into project-relative provenance', async (context) => {
  if (process.platform !== 'win32') {
    context.skip('Windows realpath normalization');
    return;
  }
  const root = await projectFixture(context, singlePlan({ kind: 'file', path: 'fixtures/browser.png' }));
  const resolved = await resolveTimeline('proof', root);
  assert.equal(resolved.projectPlanPath, '.demoweave/timelines/proof.json');
  assert.equal(resolved.scenes[0]?.panes[0]?.resolved.projectPath, 'fixtures/browser.png');
});

test('resolves Evidence GIF and project-relative PNG with hashes', async (context) => {
  const plan = TimelinePlanSchema.parse({
    ...singlePlan(),
    scenes: [{
      id: 'split',
      durationMs: 1200,
      layout: { type: 'split', direction: 'horizontal', gap: 24, padding: 32 },
      panes: [
        { id: 'terminal', source: { kind: 'evidence', evidenceId: 'terminal-gif' }, fit: 'contain' },
        { id: 'browser', source: { kind: 'file', path: 'fixtures/browser.png' }, fit: 'cover' },
      ],
    }],
  });
  const root = await projectFixture(context, plan);
  const resolved = await resolveTimeline('proof', root);
  assert.equal(resolved.scenes[0]?.panes[0]?.resolved.evidenceId, 'terminal-gif');
  assert.equal(resolved.scenes[0]?.panes[0]?.resolved.format, 'gif');
  assert.equal(resolved.scenes[0]?.panes[1]?.resolved.projectPath, 'fixtures/browser.png');
  assert.match(resolved.planHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(resolved.scenes[0]?.panes[1]?.resolved.hash ?? '', /^sha256:[0-9a-f]{64}$/);
});

test('rejects missing, unsupported, traversal, absolute, and symlink-escape sources', async (context) => {
  const missingEvidence = await projectFixture(context, singlePlan({ kind: 'evidence', evidenceId: 'missing' }));
  await assert.rejects(resolveTimeline('proof', missingEvidence), (error: unknown) => error instanceof RendererError && error.code === 'EVIDENCE_NOT_FOUND');

  const missingFile = await projectFixture(context, singlePlan({ kind: 'file', path: 'fixtures/missing.png' }));
  await assert.rejects(resolveTimeline('proof', missingFile), (error: unknown) => error instanceof RendererError && error.code === 'SOURCE_NOT_FOUND');

  const unsupported = await projectFixture(context, singlePlan({ kind: 'file', path: 'fixtures/proof.jpg' }));
  await fs.writeFile(path.join(unsupported, 'fixtures', 'proof.jpg'), 'not media');
  await assert.rejects(resolveTimeline('proof', unsupported), (error: unknown) => error instanceof RendererError && error.code === 'UNSUPPORTED_SOURCE_FORMAT');

  for (const unsafe of ['../escape.png', 'C:\\escape.png', '/tmp/escape.png', '\\\\server\\share\\escape.png']) {
    const root = await projectFixture(context, singlePlan({ kind: 'file', path: unsafe }));
    await assert.rejects(resolveTimeline('proof', root), (error: unknown) => error instanceof RendererError && error.code === 'UNSAFE_SOURCE_PATH');
  }

  const symlinkRoot = await projectFixture(context, singlePlan({ kind: 'file', path: 'fixtures/link.png' }));
  const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-outside-')), 'outside.png');
  context.after(() => fs.rm(path.dirname(outside), { recursive: true, force: true }));
  await fs.copyFile(path.join(repository, 'docs-media', 'inspect-project-terminal.png'), outside);
  try {
    await fs.symlink(outside, path.join(symlinkRoot, 'fixtures', 'link.png'));
    await assert.rejects(resolveTimeline('proof', symlinkRoot), (error: unknown) => error instanceof RendererError && error.code === 'UNSAFE_SOURCE_PATH');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
});

test('compileLayout calculates deterministic single and split rectangles', () => {
  const plan = singlePlan();
  assert.deepEqual(compileLayout(plan, plan.scenes[0]!), {
    padding: 20,
    gap: 0,
    panes: [{ x: 20, y: 20, width: 600, height: 320 }],
  });
  const split = TimelinePlanSchema.parse({
    ...plan,
    scenes: [{
      id: 'split', durationMs: 1000,
      layout: { type: 'split', direction: 'horizontal', padding: 20, gap: 20, ratio: 0.4 },
      panes: [
        { id: 'one', source: { kind: 'file', path: 'one.png' }, fit: 'contain' },
        { id: 'two', source: { kind: 'file', path: 'two.png' }, fit: 'cover' },
      ],
    }],
  });
  assert.deepEqual(compileLayout(split, split.scenes[0]!), {
    padding: 20,
    gap: 20,
    panes: [
      { x: 20, y: 20, width: 232, height: 320 },
      { x: 272, y: 20, width: 348, height: 320 },
    ],
  });
});

test('compiles semantic fit, static looping, animated looping, FPS, duration, and scene cuts', async (context) => {
  const plan = TimelinePlanSchema.parse({
    ...singlePlan(),
    scenes: [
      singlePlan().scenes[0],
      {
        id: 'split', durationMs: 1500, transition: 'cut',
        layout: { type: 'split', direction: 'horizontal', padding: 20, gap: 20 },
        panes: [
          { id: 'browser', source: { kind: 'file', path: 'fixtures/browser.png' }, fit: 'cover' },
          { id: 'terminal', source: { kind: 'evidence', evidenceId: 'terminal-gif' }, fit: 'contain' },
        ],
      },
    ],
  });
  const root = await projectFixture(context, plan);
  const resolved = await resolveTimeline('proof', root);
  const args = compileCompositionArguments(resolved, 'mp4', path.join(root, 'out.mp4'));
  assert.ok(args.includes('-loop'));
  assert.ok(args.includes('-stream_loop'));
  const graph = args[args.indexOf('-filter_complex') + 1]!;
  assert.match(graph, /force_original_aspect_ratio=decrease/);
  assert.match(graph, /force_original_aspect_ratio=increase,crop=/);
  assert.match(graph, /fps=12/);
  assert.match(graph, /trim=duration=1\.500/);
  assert.match(graph, /concat=n=2:v=1:a=0/);
  assert.doesNotMatch(graph, /stretch|hstack/);
});

test('records composed Evidence with plan/file hashes and only local Evidence in derivedFrom', async (context) => {
  const plan = TimelinePlanSchema.parse({
    ...singlePlan(),
    scenes: [{
      id: 'split', durationMs: 1000,
      layout: { type: 'split', direction: 'horizontal' },
      panes: [
        { id: 'terminal', source: { kind: 'evidence', evidenceId: 'terminal-gif' }, fit: 'contain' },
        { id: 'browser', source: { kind: 'file', path: 'fixtures/browser.png' }, fit: 'contain' },
      ],
    }],
  });
  const root = await projectFixture(context, plan);
  const runner: ProcessRunner = async (_executable, args) => {
    if (args[0] === '-version') return { exitCode: 0, stdout: 'ffmpeg version test', stderr: '' };
    await fs.writeFile(args.at(-1)!, Buffer.from('synthetic-mp4'));
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const result = await composeTimeline('proof', { projectRoot: root, format: 'mp4', processRunner: runner });
  assert.equal(result.durationMs, 1000);
  assert.equal(result.frameCount, 12);
  assert.equal(result.evidenceId, 'proof-mp4');
  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8')));
  assert.deepEqual(manifest.flows, [{ id: 'preserved', path: '.demoweave/flows/preserved.json', surfaceId: 'terminal-preserved' }]);
  const output = manifest.evidence.find((item) => item.id === 'proof-mp4');
  assert.equal(output?.producer?.id, 'compositor');
  assert.deepEqual(output?.derivedFrom, ['terminal-gif']);
  assert.deepEqual(output?.provenance.sources.map((source) => [source.path, source.role]), [
    ['.demoweave/timelines/proof.json', 'config'],
    ['fixtures/browser.png', 'asset'],
  ]);
  assert.ok(output?.provenance.sources.every((source) => /^sha256:[0-9a-f]{64}$/.test(source.hash ?? '')));
});

test('reports missing and failed FFmpeg and cleans temporary directories', async (context) => {
  const root = await projectFixture(context);
  const before = new Set((await fs.readdir(os.tmpdir())).filter((name) => name.startsWith('demoweave-compose-')));
  const missing: ProcessRunner = async () => ({ exitCode: null, stdout: '', stderr: '' });
  await assert.rejects(composeTimeline('proof', { projectRoot: root, format: 'mp4', processRunner: missing }),
    (error: unknown) => error instanceof RendererError && error.code === 'FFMPEG_NOT_FOUND');
  const failing: ProcessRunner = async (_executable, args) => args[0] === '-version'
    ? { exitCode: 0, stdout: 'ffmpeg version test', stderr: '' }
    : { exitCode: 7, stdout: '', stderr: 'synthetic failure' };
  await assert.rejects(composeTimeline('proof', { projectRoot: root, format: 'mp4', processRunner: failing }),
    (error: unknown) => error instanceof RendererError && error.code === 'FFMPEG_FAILED');

  const available: ProcessRunner = async () => ({ exitCode: 0, stdout: 'ffmpeg version test', stderr: '' });
  await assert.rejects(composeTimeline('proof', { projectRoot: root, format: 'mp4', outputPath: '../escape.mp4', processRunner: available }),
    (error: unknown) => error instanceof RendererError && error.code === 'UNSAFE_OUTPUT_PATH');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-output-outside-'));
  context.after(() => fs.rm(outside, { recursive: true, force: true }));
  try {
    await fs.symlink(outside, path.join(root, 'escaped-output'), 'dir');
    await assert.rejects(composeTimeline('proof', { projectRoot: root, format: 'mp4', outputPath: 'escaped-output/proof.mp4', processRunner: available }),
      (error: unknown) => error instanceof RendererError && error.code === 'UNSAFE_OUTPUT_PATH');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
  const after = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith('demoweave-compose-') && !before.has(name));
  assert.deepEqual(after, []);
});

test('real FFmpeg smoke generates deterministic-dimension MP4 and animated GIF when available', async (context) => {
  if (!(await ffmpegVersion())) {
    context.skip('FFmpeg is not available on PATH');
    return;
  }
  const root = await projectFixture(context);
  const mp4 = await composeTimeline('proof', { projectRoot: root, format: 'mp4' });
  const gif = await composeTimeline('proof', { projectRoot: root, format: 'gif' });
  assert.ok(mp4.sizeBytes > 0);
  const gifInfo = inspectMediaBytes(await fs.readFile(gif.outputPath));
  assert.equal(gifInfo.width, 640);
  assert.equal(gifInfo.height, 360);
  assert.ok((gifInfo.frameCount ?? 0) > 1);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,avg_frame_rate:format=duration', '-of', 'json', mp4.outputPath], { encoding: 'utf8', shell: false });
  assert.equal(probe.status, 0, probe.stderr);
  const details = JSON.parse(probe.stdout);
  assert.equal(details.streams[0].width, 640);
  assert.equal(details.streams[0].height, 360);
  assert.equal(details.streams[0].avg_frame_rate, '12/1');
  assert.ok(Number(details.format.duration) >= 0.99 && Number(details.format.duration) <= 1.1);
});
