import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repository = path.resolve(process.cwd(), '../..');
const cli = path.join(process.cwd(), 'dist', 'index.js');

function hash(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', windowsHide: true });
}

async function fixture(context: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-qa-'));
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
      provenance: { sources: [] },
    }],
  }, null, 2)}\n`);
  return root;
}

test('qa prepare creates a packet, contact sheet, and pending report', async (context) => {
  const root = await fixture(context);
  const result = run(['qa', 'prepare', 'proof-image', '--project', root, '--id', 'proof-review'], root);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Visual QA packet: proof-review/);
  assert.match(result.stdout, /Samples: 1/);
  assert.match(result.stdout, /created pending template/);
  await fs.access(path.join(root, '.demoweave', 'cache', 'qa', 'proof-review', 'packet.json'));
  await fs.access(path.join(root, '.demoweave', 'cache', 'qa', 'proof-review', 'contact-sheet.png'));
  const report = JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'qa', 'reports', 'proof-review.json'), 'utf8'));
  assert.equal(report.verdict, 'pending');
});

test('qa finalize rejects pending, then records a passing report as Evidence', async (context) => {
  const root = await fixture(context);
  assert.equal(run(['qa', 'prepare', 'proof-image', '--project', root, '--id', 'proof-review'], root).status, 0);
  const pending = run(['qa', 'finalize', 'proof-review', '--project', root], root);
  assert.equal(pending.status, 1);
  assert.match(pending.stderr, /QA_REVIEW_PENDING/);

  const reportPath = path.join(root, '.demoweave', 'qa', 'reports', 'proof-review.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  report.verdict = 'pass';
  report.findings = [{ id: 'looks-good', severity: 'info', category: 'readability', message: 'The sampled screenshot is readable.', sampleId: 'frame-001' }];
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const finalized = run(['qa', 'finalize', 'proof-review', '--project', root], root);
  assert.equal(finalized.status, 0, `${finalized.stdout}\n${finalized.stderr}`);
  assert.match(finalized.stdout, /Verdict: PASS/);
  assert.match(finalized.stdout, /Evidence: proof-review-report/);
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8'));
  const evidence = manifest.evidence.find((item: any) => item.id === 'proof-review-report');
  assert.deepEqual(evidence.derivedFrom, ['proof-image']);
  assert.equal(evidence.producer.id, 'visual-qa');
});

test('qa finalize records needs-changes but returns a failing gate exit status', async (context) => {
  const root = await fixture(context);
  assert.equal(run(['qa', 'prepare', 'proof-image', '--project', root, '--id', 'proof-review'], root).status, 0);
  const reportPath = path.join(root, '.demoweave', 'qa', 'reports', 'proof-review.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  report.verdict = 'needs-changes';
  report.findings = [{ id: 'clipped', severity: 'warning', category: 'clipping', message: 'A label is clipped.', sampleId: 'frame-001', recommendation: 'Increase padding.' }];
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const finalized = run(['qa', 'finalize', 'proof-review', '--project', root], root);
  assert.equal(finalized.status, 1);
  assert.match(finalized.stdout, /Verdict: NEEDS-CHANGES/);
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8'));
  assert.ok(manifest.evidence.some((item: any) => item.id === 'proof-review-report'));
});
