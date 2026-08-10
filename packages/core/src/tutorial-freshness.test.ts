import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeFreshness } from './freshness.js';

function hash(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

test('tutorial outputs follow source/plan freshness without inventing a rebuild action', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-tutorial-freshness-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'tutorials'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs-media'), { recursive: true });

  const source = Buffer.from('source mp4 bytes');
  const output = Buffer.from('tutorial output bytes');
  const plan = '{"schemaVersion":1,"id":"proof"}\n';
  await fs.writeFile(path.join(root, 'docs-media', 'source.mp4'), source);
  await fs.writeFile(path.join(root, 'docs-media', 'proof-thumbnail.png'), output);
  await fs.writeFile(path.join(root, '.demoweave', 'tutorials', 'proof.json'), plan);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [
      {
        schemaVersion: 1,
        id: 'source-video',
        kind: 'recording',
        status: 'available',
        format: 'mp4',
        path: 'docs-media/source.mp4',
        artifactHash: hash(source),
        provenance: { sources: [] },
      },
      {
        schemaVersion: 1,
        id: 'proof-thumbnail',
        kind: 'image',
        status: 'available',
        format: 'png',
        path: 'docs-media/proof-thumbnail.png',
        artifactHash: hash(output),
        producer: { kind: 'renderer', id: 'tutorial', version: '0.0.1' },
        provenance: {
          sources: [{ path: '.demoweave/tutorials/proof.json', role: 'config', hash: hash(plan) }],
        },
        derivedFrom: ['source-video'],
      },
    ],
  }, null, 2)}\n`);

  const fresh = await analyzeFreshness(root);
  assert.equal(fresh.evidence.find((item) => item.evidenceId === 'proof-thumbnail')?.state, 'fresh');
  assert.deepEqual(fresh.regeneration, []);

  await fs.writeFile(path.join(root, '.demoweave', 'tutorials', 'proof.json'), '{"schemaVersion":1,"id":"proof","changed":true}\n');
  const planStale = await analyzeFreshness(root);
  assert.equal(planStale.evidence.find((item) => item.evidenceId === 'proof-thumbnail')?.state, 'stale');
  assert.ok(planStale.evidence.find((item) => item.evidenceId === 'proof-thumbnail')?.reasons.some((reason) => reason.code === 'source-changed'));
  assert.deepEqual(planStale.regeneration, []);

  await fs.writeFile(path.join(root, '.demoweave', 'tutorials', 'proof.json'), plan);
  await fs.writeFile(path.join(root, 'docs-media', 'source.mp4'), Buffer.from('changed source mp4 bytes'));
  const sourceStale = await analyzeFreshness(root);
  assert.equal(sourceStale.evidence.find((item) => item.evidenceId === 'source-video')?.state, 'stale');
  assert.equal(sourceStale.evidence.find((item) => item.evidenceId === 'proof-thumbnail')?.state, 'stale');
  assert.ok(sourceStale.evidence.find((item) => item.evidenceId === 'proof-thumbnail')?.reasons.some((reason) => reason.code === 'upstream-stale'));
  assert.deepEqual(sourceStale.regeneration, []);
});
