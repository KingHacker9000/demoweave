import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FlowSchema, ManifestSchema, type Surface } from '@demoweave/core';
import { ResearchDriver } from './research-driver.js';
import type { DriverContext } from './index.js';
import type { TerminalSession, TerminalSessionResult, TerminalSessionRunOptions } from './terminal-session.js';

class FakeSession implements TerminalSession {
  readonly mode = 'pipe' as const;
  result: TerminalSessionResult = {
    stdout: 'accuracy=0.93\n',
    stderr: '',
    combined: 'accuracy=0.93\n',
    exitCode: 0,
    durationMs: 5,
    timedOut: false,
  };

  async run(options: TerminalSessionRunOptions): Promise<TerminalSessionResult> {
    options.onOutput('stdout', this.result.stdout);
    return this.result;
  }

  async close(): Promise<void> {}
}

async function project(context: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-research-driver-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: 'experiment', path: '.demoweave/flows/experiment.json', surfaceId: 'research-fixture' }],
    evidence: [],
  }, null, 2)}\n`);
  return root;
}

function flow() {
  return FlowSchema.parse({
    schemaVersion: 1,
    id: 'experiment',
    surfaceId: 'research-fixture',
    sources: [{ path: 'analysis.py', role: 'implementation' }],
    steps: [
      { id: 'run', type: 'run', command: 'python', args: ['analysis.py'] },
      { id: 'assert-output', type: 'assert', assertion: { kind: 'outputContains', stream: 'stdout', value: 'accuracy=0.93' } },
      { id: 'capture-metrics', type: 'capture', evidenceId: 'metrics', kind: 'result', artifact: { path: 'outputs/metrics.json' } },
    ],
  });
}

function context(root: string, surfaceType: 'research' | 'notebook' = 'research'): DriverContext {
  const surface: Surface = {
    id: surfaceType === 'research' ? 'research-fixture' : 'notebook-fixture',
    type: surfaceType,
    root: '.',
  };
  const parsed = flow();
  return { projectRoot: root, surface, flow: { ...parsed, surfaceId: surface.id } };
}

test('supports research and notebook surfaces with process/artifact actions', async () => {
  const driver = new ResearchDriver();
  assert.equal(driver.supports(context('/tmp').surface), true);
  assert.equal(driver.supports(context('/tmp', 'notebook').surface), true);
  assert.deepEqual(driver.descriptor.stepTypes, ['run', 'wait', 'assert', 'capture']);
});

test('runs commands and asserts their output through the lightweight process session', async (t) => {
  const root = await project(t);
  await fs.writeFile(path.join(root, 'analysis.py'), 'print("accuracy=0.93")\n');
  const session = new FakeSession();
  const driver = new ResearchDriver({ sessionFactory: () => session });
  const ctx = context(root);
  await driver.prepare(ctx);
  const runResult = await driver.execute(ctx.flow.steps[0]!, ctx);
  assert.equal(runResult.status, 'passed');
  assert.equal(runResult.stdout, 'accuracy=0.93\n');
  const assertion = await driver.execute(ctx.flow.steps[1]!, ctx);
  assert.equal(assertion.status, 'passed');
  await driver.close(ctx);
});

test('captures a native JSON artifact as immutable Evidence with source provenance', async (t) => {
  const root = await project(t);
  await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
  await fs.writeFile(path.join(root, 'analysis.py'), '# deterministic research fixture\n');
  await fs.writeFile(path.join(root, 'outputs', 'metrics.json'), '{"accuracy":0.93}\n');
  const driver = new ResearchDriver({ sessionFactory: () => new FakeSession() });
  const ctx = context(root);
  await driver.prepare(ctx);
  const result = await driver.execute(ctx.flow.steps[2]!, ctx);
  assert.equal(result.status, 'passed');
  assert.equal(result.evidence?.[0]?.id, 'metrics');
  assert.equal(result.evidence?.[0]?.format, 'json');
  assert.equal(result.evidence?.[0]?.producer?.id, 'research');
  assert.equal(result.evidence?.[0]?.provenance.surfaceId, 'research-fixture');
  assert.equal(result.evidence?.[0]?.provenance.sources[0]?.path, 'outputs/metrics.json');
  assert.match(result.evidence?.[0]?.provenance.sources[0]?.hash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.equal(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'metrics.json'), 'utf8'), '{"accuracy":0.93}\n');
  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8')));
  assert.equal(manifest.evidence.find((item) => item.id === 'metrics')?.kind, 'result');
  await driver.close(ctx);
});

test('captures executed notebooks as ipynb Evidence without parsing notebook UI', async (t) => {
  const root = await project(t);
  await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
  await fs.writeFile(path.join(root, 'outputs', 'executed.ipynb'), '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}\n');
  const parsed = FlowSchema.parse({
    schemaVersion: 1,
    id: 'notebook',
    surfaceId: 'notebook-fixture',
    steps: [{ id: 'capture', type: 'capture', evidenceId: 'executed-notebook', kind: 'result', artifact: { path: 'outputs/executed.ipynb' } }],
  });
  const ctx: DriverContext = { projectRoot: root, surface: { id: 'notebook-fixture', type: 'notebook', root: '.' }, flow: parsed };
  const driver = new ResearchDriver({ sessionFactory: () => new FakeSession() });
  await driver.prepare(ctx);
  const result = await driver.execute(parsed.steps[0]!, ctx);
  assert.equal(result.status, 'passed');
  assert.equal(result.evidence?.[0]?.format, 'ipynb');
  assert.equal(result.evidence?.[0]?.mimeType, 'application/x-ipynb+json');
  await driver.close(ctx);
});

test('rejects traversal, unsupported formats, and UI-target capture', async (t) => {
  const root = await project(t);
  await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
  await fs.writeFile(path.join(root, 'outputs', 'model.bin'), 'binary-ish');
  const driver = new ResearchDriver({ sessionFactory: () => new FakeSession() });
  const ctx = context(root);
  await driver.prepare(ctx);

  const traversal = FlowSchema.parse({
    schemaVersion: 1,
    id: 'bad',
    surfaceId: 'research-fixture',
    steps: [{ id: 'capture', type: 'capture', evidenceId: 'bad', kind: 'result', artifact: { path: '../outside.json' } }],
  }).steps[0]!;
  const traversalResult = await driver.execute(traversal, ctx);
  assert.equal(traversalResult.status, 'failed');

  const unsupported = FlowSchema.parse({
    schemaVersion: 1,
    id: 'bad-format',
    surfaceId: 'research-fixture',
    steps: [{ id: 'capture', type: 'capture', evidenceId: 'bad-format', kind: 'result', artifact: { path: 'outputs/model.bin' } }],
  }).steps[0]!;
  const unsupportedResult = await driver.execute(unsupported, ctx);
  assert.equal(unsupportedResult.error?.code, 'UNSUPPORTED_ARTIFACT_FORMAT');

  assert.equal(FlowSchema.safeParse({
    schemaVersion: 1,
    id: 'mutually-exclusive',
    surfaceId: 'research-fixture',
    steps: [{
      id: 'capture',
      type: 'capture',
      evidenceId: 'bad-target',
      kind: 'image',
      artifact: { path: 'outputs/image.png' },
      target: { strategy: 'text', value: 'anything' },
    }],
  }).success, false);
  await driver.close(ctx);
});

test('rejects artifact symlink escapes when the platform permits symlinks', async (t) => {
  const root = await project(t);
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-research-outside-'));
  t.after(() => fs.rm(outsideDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
  const outside = path.join(outsideDir, 'secret.json');
  await fs.writeFile(outside, '{"secret":true}\n');
  try {
    await fs.symlink(outside, path.join(root, 'outputs', 'escape.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('symlink creation is not permitted on this host');
      return;
    }
    throw error;
  }

  const parsed = FlowSchema.parse({
    schemaVersion: 1,
    id: 'escape',
    surfaceId: 'research-fixture',
    steps: [{ id: 'capture', type: 'capture', evidenceId: 'escape', kind: 'result', artifact: { path: 'outputs/escape.json' } }],
  });
  const ctx = context(root);
  const driver = new ResearchDriver({ sessionFactory: () => new FakeSession() });
  await driver.prepare(ctx);
  const result = await driver.execute(parsed.steps[0]!, ctx);
  assert.equal(result.status, 'failed');
  assert.match(result.error?.message ?? '', /outside the project root/);
  await driver.close(ctx);
});
