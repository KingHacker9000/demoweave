import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  FreshnessReportSchema,
  analyzeFreshness,
  snapshotEvidenceArtifact,
  snapshotFlowEvidence,
} from './index.js';

const repository = path.resolve(process.cwd(), '../..');

function hash(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function fixture(context: TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-freshness-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'flows'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence', 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs-media'), { recursive: true });
  return root;
}

async function writeJson(target: string, value: unknown): Promise<void> {
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

test('explains source -> derived evidence -> document stale chains and computes the minimal plan', async (context) => {
  const root = await fixture(context);
  const source = 'export const value = 1;\n';
  const flow = {
    schemaVersion: 1,
    id: 'demo',
    surfaceId: 'terminal-demo',
    sources: [{ path: 'src/tool.ts', role: 'implementation' }],
    steps: [
      { id: 'run', type: 'run', command: 'node', args: ['tool.js'] },
      { id: 'capture', type: 'capture', evidenceId: 'terminal', kind: 'terminal' },
    ],
  };
  const artifact = '{"track":true}\n';
  const gif = Buffer.from('GIF89a-fixture');
  await fs.writeFile(path.join(root, 'src', 'tool.ts'), source);
  await writeJson(path.join(root, '.demoweave', 'flows', 'demo.json'), flow);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'terminal.terminal.json'), artifact);
  await fs.writeFile(path.join(root, 'docs-media', 'terminal.gif'), gif);
  await fs.writeFile(path.join(root, 'README.md'), '# Demo\n\n![Demo](docs-media/terminal.gif)\n');

  const flowBytes = await fs.readFile(path.join(root, '.demoweave', 'flows', 'demo.json'));
  const manifest = {
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: 'demo', path: '.demoweave/flows/demo.json', surfaceId: 'terminal-demo' }],
    evidence: [
      {
        schemaVersion: 1,
        id: 'terminal',
        kind: 'terminal',
        status: 'available',
        format: 'json',
        path: '.demoweave/evidence/artifacts/terminal.terminal.json',
        artifactHash: hash(artifact),
        provenance: {
          flowId: 'demo',
          stepId: 'capture',
          surfaceId: 'terminal-demo',
          flowHash: hash(flowBytes),
          sources: [{ path: 'src/tool.ts', role: 'implementation', hash: hash(source) }],
        },
      },
      {
        schemaVersion: 1,
        id: 'terminal-gif',
        kind: 'recording',
        status: 'available',
        format: 'gif',
        path: 'docs-media/terminal.gif',
        artifactHash: hash(gif),
        provenance: {
          flowId: 'demo',
          stepId: 'capture',
          surfaceId: 'terminal-demo',
          flowHash: hash(flowBytes),
          sources: [{ path: 'src/tool.ts', role: 'implementation', hash: hash(source) }],
        },
        derivedFrom: ['terminal'],
      },
    ],
  };
  await writeJson(path.join(root, '.demoweave', 'evidence', 'manifest.json'), manifest);

  const fresh = await analyzeFreshness(root);
  assert.deepEqual(fresh.summary, { fresh: 2, stale: 0, missing: 0, unknown: 0, impactedDocuments: 0, actions: 0 });

  await fs.writeFile(path.join(root, 'src', 'tool.ts'), 'export const value = 2;\n');
  const stale = await analyzeFreshness(root);
  assert.equal(stale.evidence.find((item) => item.evidenceId === 'terminal')?.state, 'stale');
  assert.ok(stale.evidence.find((item) => item.evidenceId === 'terminal')?.reasons.some((reason) => reason.code === 'source-changed'));
  assert.ok(stale.evidence.find((item) => item.evidenceId === 'terminal-gif')?.reasons.some((reason) => reason.code === 'upstream-stale'));
  assert.deepEqual(stale.documents, [{ path: 'README.md', evidenceIds: ['terminal-gif'] }]);
  assert.deepEqual(stale.regeneration, [
    { kind: 'run-flow', flowId: 'demo', evidenceIds: ['terminal'] },
    { kind: 'render-evidence', sourceEvidenceId: 'terminal', evidenceId: 'terminal-gif', format: 'gif', outputPath: 'docs-media/terminal.gif' },
  ]);
});

test('missing artifacts are distinguished from unknown baselines', async (context) => {
  const root = await fixture(context);
  await fs.writeFile(path.join(root, 'src', 'tool.ts'), 'source\n');
  await writeJson(path.join(root, '.demoweave', 'flows', 'demo.json'), {
    schemaVersion: 1,
    id: 'demo',
    surfaceId: 'terminal-demo',
    steps: [{ id: 'capture', type: 'capture', evidenceId: 'terminal', kind: 'terminal' }],
  });
  await writeJson(path.join(root, '.demoweave', 'evidence', 'manifest.json'), {
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: 'demo', path: '.demoweave/flows/demo.json', surfaceId: 'terminal-demo' }],
    evidence: [{
      schemaVersion: 1,
      id: 'terminal',
      kind: 'terminal',
      status: 'available',
      format: 'json',
      path: '.demoweave/evidence/artifacts/missing.json',
      provenance: { flowId: 'demo', sources: [{ path: 'src/tool.ts' }] },
    }],
  });
  const report = await analyzeFreshness(root);
  assert.equal(report.evidence[0]?.state, 'missing');
  assert.ok(report.evidence[0]?.reasons.some((reason) => reason.code === 'artifact-missing'));
  assert.ok(report.evidence[0]?.reasons.some((reason) => reason.code === 'source-baseline-unavailable'));
});

test('marks compositor Evidence stale without inventing a terminal render action', async (context) => {
  const root = await fixture(context);
  const source = Buffer.from('source gif');
  const composition = Buffer.from('composed gif');
  const plan = '{"schemaVersion":1}\n';
  await fs.writeFile(path.join(root, 'docs-media', 'source.gif'), source);
  await fs.writeFile(path.join(root, 'docs-media', 'composition.gif'), composition);
  await fs.mkdir(path.join(root, '.demoweave', 'timelines'), { recursive: true });
  await fs.writeFile(path.join(root, '.demoweave', 'timelines', 'proof.json'), plan);
  await writeJson(path.join(root, '.demoweave', 'evidence', 'manifest.json'), {
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [
      {
        schemaVersion: 1,
        id: 'source-gif',
        kind: 'recording',
        status: 'available',
        format: 'gif',
        path: 'docs-media/source.gif',
        artifactHash: hash(source),
        provenance: { sources: [] },
      },
      {
        schemaVersion: 1,
        id: 'composition-gif',
        kind: 'recording',
        status: 'available',
        format: 'gif',
        path: 'docs-media/composition.gif',
        artifactHash: hash(composition),
        producer: { kind: 'renderer', id: 'compositor', version: '0.0.1' },
        provenance: { sources: [{ path: '.demoweave/timelines/proof.json', role: 'config', hash: hash(plan) }] },
        derivedFrom: ['source-gif'],
      },
    ],
  });

  await fs.writeFile(path.join(root, '.demoweave', 'timelines', 'proof.json'), '{"schemaVersion":1,"changed":true}\n');
  const report = await analyzeFreshness(root);
  assert.equal(report.evidence.find((item) => item.evidenceId === 'composition-gif')?.state, 'stale');
  assert.deepEqual(report.regeneration, []);
});

test('snapshot helpers persist Flow/source/artifact hashes without changing artifact bytes', async (context) => {
  const root = await fixture(context);
  const source = 'source bytes\n';
  const artifact = 'artifact bytes\n';
  const derived = 'rendered bytes\n';
  await fs.writeFile(path.join(root, 'src', 'tool.ts'), source);
  await writeJson(path.join(root, '.demoweave', 'flows', 'demo.json'), {
    schemaVersion: 1,
    id: 'demo',
    surfaceId: 'terminal-demo',
    sources: [{ path: 'src/tool.ts', role: 'implementation' }],
    steps: [{ id: 'capture', type: 'capture', evidenceId: 'terminal', kind: 'terminal' }],
  });
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'terminal.json'), artifact);
  await fs.writeFile(path.join(root, 'docs-media', 'terminal.png'), derived);
  await writeJson(path.join(root, '.demoweave', 'evidence', 'manifest.json'), {
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: 'demo', path: '.demoweave/flows/demo.json', surfaceId: 'terminal-demo' }],
    evidence: [
      {
        schemaVersion: 1,
        id: 'terminal',
        kind: 'terminal',
        status: 'available',
        path: '.demoweave/evidence/artifacts/terminal.json',
        provenance: { flowId: 'demo', sources: [] },
      },
      {
        schemaVersion: 1,
        id: 'terminal-png',
        kind: 'image',
        status: 'available',
        format: 'png',
        path: 'docs-media/terminal.png',
        provenance: { flowId: 'demo', sources: [] },
        derivedFrom: ['terminal'],
      },
    ],
  });

  const before = await fs.readFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'terminal.json'));
  const [snapshotted] = await snapshotFlowEvidence(root, 'demo');
  assert.equal(snapshotted?.artifactHash, hash(artifact));
  assert.equal(snapshotted?.provenance.sources[0]?.hash, hash(source));
  assert.match(snapshotted?.provenance.flowHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'terminal.json')), before);

  const rendered = await snapshotEvidenceArtifact(root, 'terminal-png');
  assert.equal(rendered.artifactHash, hash(derived));
});

test('runtime and published FreshnessReport v1 contracts stay aligned', async () => {
  const sample = {
    schemaVersion: 1,
    evidence: [{ evidenceId: 'e', state: 'fresh', reasons: [] }],
    documents: [],
    regeneration: [],
    summary: { fresh: 1, stale: 0, missing: 0, unknown: 0, impactedDocuments: 0, actions: 0 },
  };
  assert.equal(FreshnessReportSchema.safeParse(sample).success, true);
  const published = JSON.parse(await fs.readFile(path.join(repository, 'schemas', 'freshness-report.schema.json'), 'utf8')) as any;
  assert.equal(published.properties.schemaVersion.const, 1);
  assert.deepEqual(published.$defs.evidenceFreshness.properties.state.enum, ['fresh', 'stale', 'missing', 'unknown']);
});
