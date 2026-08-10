import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeFreshness } from '@demoweave/core';
import { finalizeVisualQa, prepareVisualQa } from './visual-qa.js';

const repository = path.resolve(process.cwd(), '../..');

function hash(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

test('finalized visual QA Evidence becomes stale when its reviewed source changes', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-qa-freshness-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  const source = await fs.readFile(path.join(repository, 'docs-media', 'inspect-project-terminal.png'));
  await fs.writeFile(path.join(root, 'media', 'proof.png'), source);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [{
      schemaVersion: 1,
      id: 'proof-image',
      kind: 'image',
      status: 'available',
      format: 'png',
      path: 'media/proof.png',
      artifactHash: hash(source),
      provenance: { sources: [] }
    }]
  }, null, 2)}\n`);

  const prepared = await prepareVisualQa('proof-image', { projectRoot: root, id: 'proof-review' });
  const report = JSON.parse(await fs.readFile(prepared.reportPath, 'utf8'));
  report.verdict = 'pass';
  report.findings = [{ id: 'reviewed', severity: 'info', category: 'readability', message: 'The reviewed screenshot is readable.', sampleId: 'frame-001' }];
  await fs.writeFile(prepared.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await finalizeVisualQa('proof-review', { projectRoot: root });

  const fresh = await analyzeFreshness(root);
  assert.equal(fresh.evidence.find((item) => item.evidenceId === 'proof-image')?.state, 'fresh');
  assert.equal(fresh.evidence.find((item) => item.evidenceId === 'proof-review-report')?.state, 'fresh');

  await fs.appendFile(path.join(root, 'media', 'proof.png'), Buffer.from('changed'));
  const stale = await analyzeFreshness(root);
  assert.equal(stale.evidence.find((item) => item.evidenceId === 'proof-image')?.state, 'stale');
  const qa = stale.evidence.find((item) => item.evidenceId === 'proof-review-report');
  assert.equal(qa?.state, 'stale');
  assert.ok(qa?.reasons.some((reason) => reason.code === 'upstream-stale'));
});
