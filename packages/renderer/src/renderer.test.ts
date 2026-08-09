import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ManifestSchema, TerminalTrackSchema, type TerminalTrack } from '@demoweave/core';
import {
  AnsiTokenizer,
  createTerminalLayout,
  createTerminalPresentation,
  getRendererCapabilities,
  loadTerminalTrack,
  presentationFrameTimes,
  renderEvidence,
  RendererError,
  renderTerminalSvg,
  renderTerminalTrack,
  replayPresentation,
  TerminalReplay,
  type ProcessRunner,
  type Rasterizer,
} from './index.js';

function track(events: TerminalTrack['events'] = [
  { sequence: 0, t: 0, stepId: 'run', stream: 'input', data: 'demo inspect .\n' },
  { sequence: 1, t: 20, stepId: 'run', stream: 'stdout', data: 'Detected surfaces:\n  - terminal demo\n' },
  { sequence: 2, t: 22, stepId: 'run', stream: 'stderr', data: 'A quiet warning\n' },
]): TerminalTrack {
  return TerminalTrackSchema.parse({
    schemaVersion: 1,
    columns: 100,
    rows: 30,
    mode: 'pipe',
    commands: [{
      stepId: 'run',
      command: 'demo',
      args: ['inspect', '.'],
      cwd: '.',
      startedAt: 0,
      durationMs: 24,
      status: 'completed',
      exitCode: 0,
    }],
    events,
    status: 'completed',
    exitCode: 0,
    durationMs: 24,
  });
}

function lineText(frame: ReturnType<typeof replayPresentation>): string {
  return frame.rows.map((line) => line.runs.map((run) => run.text).join('')).join('\n');
}

async function temporaryProject(context: test.TestContext, options: {
  evidenceKind?: 'terminal' | 'image';
  artifact?: boolean;
  mediaDir?: string;
} = {}): Promise<{ root: string; artifactPath: string; manifestPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-renderer-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifactPath = path.join(root, '.demoweave', 'evidence', 'artifacts', 'terminal.terminal.json');
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), `${JSON.stringify({ schemaVersion: 1, mediaDir: options.mediaDir ?? 'media' }, null, 2)}\n`);
  if (options.artifact !== false) await fs.writeFile(artifactPath, `${JSON.stringify(track(), null, 2)}\n`);
  await fs.writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: 'keep-flow', path: '.demoweave/flows/keep.json', surfaceId: 'terminal-demo' }],
    evidence: [{
      schemaVersion: 1,
      id: 'terminal',
      kind: options.evidenceKind ?? 'terminal',
      status: 'available',
      label: 'Terminal demo',
      format: 'json',
      path: '.demoweave/evidence/artifacts/terminal.terminal.json',
      mimeType: 'application/vnd.demoweave.terminal+json',
      producer: { kind: 'driver', id: 'terminal', version: '0.0.1' },
      provenance: {
        flowId: 'keep-flow',
        stepId: 'capture',
        surfaceId: 'terminal-demo',
        gitCommit: 'abc123',
        sources: [{ path: 'src/demo.ts', role: 'implementation' }],
      },
    }],
  }, null, 2)}\n`);
  return { root, artifactPath, manifestPath };
}

const fakeRasterizer: Rasterizer = {
  rasterize: () => ({
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    width: 1,
    height: 1,
  }),
};

test('loads a valid TerminalTrack and rejects an invalid track', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-track-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const valid = path.join(root, 'valid.json');
  const invalid = path.join(root, 'invalid.json');
  await fs.writeFile(valid, JSON.stringify(track()));
  await fs.writeFile(invalid, JSON.stringify({ schemaVersion: 1, events: [] }));
  assert.equal((await loadTerminalTrack(valid)).mode, 'pipe');
  await assert.rejects(loadTerminalTrack(invalid), (error: unknown) => error instanceof RendererError && error.code === 'INVALID_TERMINAL_TRACK');
});

test('ANSI tokenizer applies SGR while consuming unsupported control sequences', () => {
  const tokenizer = new AnsiTokenizer();
  const tokens = tokenizer.parse('\u001b[1;34mblue\u001b[0m plain\u001b[2J\u001b]0;secret title\u0007!\u009b31mred\u009b0m');
  const text = tokens.filter((token) => token.type === 'text').map((token) => token.text).join('');
  assert.equal(text, 'blue plain!red');
  const blue = tokens.find((token) => token.type === 'text' && token.text === 'blue');
  assert.deepEqual(blue, { type: 'text', text: 'blue', style: { bold: true, foreground: '#60a5fa' } });
  assert.doesNotMatch(text, /\u001b|secret title|\[2J/);

  const split = new AnsiTokenizer();
  assert.deepEqual(split.parse('safe\u001b[3'), [{ type: 'text', text: 'safe', style: {} }]);
  const resumed = split.parse('2mgreen\u001b]0;hidden');
  assert.deepEqual(resumed, [{ type: 'text', text: 'green', style: { foreground: '#86efac' } }]);
  assert.deepEqual(split.parse(' title\u0007done'), [{ type: 'text', text: 'done', style: { foreground: '#86efac' } }]);
});

test('terminal replay handles command presentation, streams, tabs, carriage returns, and ANSI reset', () => {
  const replay = new TerminalReplay(40, 10);
  replay.apply('input', 'demo\tgo\n');
  replay.apply('stdout', 'progress 1\rprogress 2\n\u001b[2mdim\u001b[0m\n');
  replay.apply('stderr', 'warning\n');
  const rows = replay.snapshot();
  assert.equal(rows[0]?.runs.map((run) => run.text).join(''), '$ demo  go');
  assert.equal(rows[1]?.runs.map((run) => run.text).join(''), 'progress 2');
  assert.equal(rows[2]?.runs[0]?.style.dim, true);
  assert.equal(rows[3]?.runs[0]?.stream, 'stderr');
});

test('presentation timing is deterministic, readable, and only reorders timing', () => {
  const source = track();
  const first = createTerminalPresentation(source);
  const second = createTerminalPresentation(source);
  assert.deepEqual(first, second);
  assert.ok(first.durationMs >= 3_000 && first.durationMs <= 6_000, String(first.durationMs));
  assert.equal(first.finalHoldMs, 2_200);
  assert.equal(first.framesPerSecond, 12);
  assert.deepEqual(first.actions.map((action) => action.data).join(''), source.events.map((event) => event.data).join(''));
  const final = replayPresentation(source, first, first.durationMs);
  assert.match(lineText(final), /^\$ demo inspect \./);
  assert.match(lineText(final), /Detected surfaces:/);
  assert.match(lineText(final), /A quiet warning/);
  assert.equal(presentationFrameTimes(first).length, Math.ceil(first.durationMs * 12 / 1_000));
});

test('final SVG contains represented content without control garbage or source paths', () => {
  const source = track([
    { sequence: 0, t: 0, stepId: 'run', stream: 'input', data: 'demo\n' },
    { sequence: 1, t: 1, stepId: 'run', stream: 'stdout', data: '\u001b[32mSuccess\u001b[0m\u001b[2J\n' },
  ]);
  const presentation = createTerminalPresentation(source);
  const frame = replayPresentation(source, presentation, presentation.durationMs);
  const layout = createTerminalLayout(source.columns, source.rows, frame.rows);
  const svg = renderTerminalSvg(frame, layout);
  assert.match(svg, />\$ <\/text><text[^>]*>demo<\/text>/);
  assert.match(svg, /Success/);
  assert.doesNotMatch(svg, /\u001b|\[2J|demoweave-renderer-test/);
});

test('creates a headless final PNG with a valid signature and dimensions', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-png-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'terminal.png');
  const result = await renderTerminalTrack(track(), { format: 'png', outputPath });
  const png = await fs.readFile(outputPath);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), result.width);
  assert.equal(png.readUInt32BE(20), result.height);
  assert.ok(result.width >= 900 && result.width <= 1_100);
  assert.ok(result.height > 0);
});

test('uses configured mediaDir and atomically preserves and extends the manifest', async (context) => {
  const project = await temporaryProject(context, { mediaDir: 'custom-media' });
  const result = await renderEvidence('terminal', { projectRoot: project.root, format: 'png', rasterizer: fakeRasterizer });
  assert.equal(result.outputPath, path.join(project.root, 'custom-media', 'terminal.png'));
  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(project.manifestPath, 'utf8')));
  assert.deepEqual(manifest.flows, [{ id: 'keep-flow', path: '.demoweave/flows/keep.json', surfaceId: 'terminal-demo' }]);
  assert.equal(manifest.evidence.length, 2);
  const derived = manifest.evidence.find((item) => item.id === 'terminal-png');
  assert.equal(derived?.kind, 'image');
  assert.equal(derived?.format, 'png');
  assert.deepEqual(derived?.derivedFrom, ['terminal']);
  assert.deepEqual(derived?.producer, { kind: 'renderer', id: 'terminal', version: '0.0.1' });
  assert.deepEqual(derived?.provenance, manifest.evidence.find((item) => item.id === 'terminal')?.provenance);
});

test('reports missing id, wrong kind, missing artifact, and unsafe paths', async (context) => {
  const project = await temporaryProject(context);
  await assert.rejects(
    renderEvidence('missing', { projectRoot: project.root, format: 'png', rasterizer: fakeRasterizer }),
    (error: unknown) => error instanceof RendererError && error.code === 'EVIDENCE_NOT_FOUND',
  );

  const wrongKind = await temporaryProject(context, { evidenceKind: 'image' });
  await assert.rejects(
    renderEvidence('terminal', { projectRoot: wrongKind.root, format: 'png', rasterizer: fakeRasterizer }),
    (error: unknown) => error instanceof RendererError && error.code === 'WRONG_EVIDENCE_KIND',
  );

  const missingArtifact = await temporaryProject(context, { artifact: false });
  await assert.rejects(
    renderEvidence('terminal', { projectRoot: missingArtifact.root, format: 'png', rasterizer: fakeRasterizer }),
    (error: unknown) => error instanceof RendererError && error.code === 'SOURCE_ARTIFACT_NOT_FOUND',
  );

  await assert.rejects(
    renderEvidence('terminal', { projectRoot: project.root, format: 'png', outputPath: '../escape.png', rasterizer: fakeRasterizer }),
    (error: unknown) => error instanceof RendererError && error.code === 'UNSAFE_OUTPUT_PATH',
  );

  const unsafeConfig = await temporaryProject(context, { mediaDir: '../escape' });
  await assert.rejects(
    renderEvidence('terminal', { projectRoot: unsafeConfig.root, format: 'png', rasterizer: fakeRasterizer }),
    (error: unknown) => error instanceof RendererError && error.code === 'UNSAFE_MEDIA_PATH',
  );
});

test('renders a direct TerminalTrack path without inventing manifest provenance', async (context) => {
  const project = await temporaryProject(context);
  const result = await renderEvidence('.demoweave/evidence/artifacts/terminal.terminal.json', {
    projectRoot: project.root,
    format: 'png',
    rasterizer: fakeRasterizer,
  });
  assert.equal(result.evidenceId, undefined);
  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(project.manifestPath, 'utf8')));
  assert.equal(manifest.evidence.length, 1);
});

test('reports missing FFmpeg and structured FFmpeg failures', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-gif-failure-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const missing: ProcessRunner = async () => ({ exitCode: null, stdout: '', stderr: '' });
  await assert.rejects(
    renderTerminalTrack(track(), { format: 'gif', outputPath: path.join(root, 'missing.gif'), processRunner: missing, rasterizer: fakeRasterizer }),
    (error: unknown) => error instanceof RendererError && error.code === 'FFMPEG_NOT_FOUND',
  );

  const failing: ProcessRunner = async (_executable, args) => args[0] === '-version'
    ? { exitCode: 0, stdout: 'ffmpeg version test', stderr: '' }
    : { exitCode: 7, stdout: '', stderr: 'synthetic encoder failure' };
  await assert.rejects(
    renderTerminalTrack(track(), { format: 'gif', outputPath: path.join(root, 'failed.gif'), processRunner: failing, rasterizer: fakeRasterizer }),
    (error: unknown) => error instanceof RendererError && error.code === 'FFMPEG_FAILED' && /synthetic encoder failure/.test(error.message),
  );
});

test('real FFmpeg smoke creates an animated looping GIF when available', async (context) => {
  const capabilities = await getRendererCapabilities();
  if (!capabilities.gif) {
    context.skip('FFmpeg is not available on PATH');
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-gif-smoke-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'terminal.gif');
  const result = await renderTerminalTrack(track(), { format: 'gif', outputPath });
  const gif = await fs.readFile(outputPath);
  assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.ok((result.frameCount ?? 0) > 1);
  assert.ok((result.durationMs ?? 0) >= 3_000);
});
