import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repository = path.resolve(process.cwd(), '../..');
const cli = path.join(process.cwd(), 'dist', 'index.js');

function hash(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', windowsHide: true });
}

test('qa finalize refuses when upstream provenance becomes stale after packet review', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-qa-window-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });

  const source = await fs.readFile(path.join(repository, 'docs-media', 'inspect-project-terminal.png'));
  const implementation = 'version one\n';
  await fs.writeFile(path.join(root, 'media', 'proof.png'), source);
  await fs.writeFile(path.join(root, 'implementation.txt'), implementation);
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
      provenance: {
        sources: [{ path: 'implementation.txt', role: 'implementation', hash: hash(implementation) }]
      }
    }]
  }, null, 2)}\n`);

  const prepared = run(['qa', 'prepare', 'proof-image', '--project', root, '--id', 'proof-review'], root);
  assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`);
  const reportPath = path.join(root, '.demoweave', 'qa', 'reports', 'proof-review.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  report.verdict = 'pass';
  report.findings = [{ id: 'reviewed', severity: 'info', category: 'readability', message: 'The reviewed screenshot is readable.', sampleId: 'frame-001' }];
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  await fs.writeFile(path.join(root, 'implementation.txt'), 'version two\n');
  const finalized = run(['qa', 'finalize', 'proof-review', '--project', root], root);
  assert.equal(finalized.status, 1);
  assert.match(finalized.stderr, /QA_SOURCE_NOT_FRESH/);

  const manifest = JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8'));
  assert.equal(manifest.evidence.some((item: any) => item.id === 'proof-review-report'), false);
});
