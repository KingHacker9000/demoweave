import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repository = path.resolve(import.meta.dirname, '..');
const cli = path.join(repository, 'packages', 'cli', 'dist', 'index.js');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-m10-smoke-'));

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', shell: false });
}

try {
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  const source = await fs.readFile(path.join(repository, 'docs-media', 'terminal-web-proof.mp4'));
  await fs.writeFile(path.join(root, 'media', 'proof.mp4'), source);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [{
      schemaVersion: 1,
      id: 'proof-video',
      kind: 'recording',
      status: 'available',
      format: 'mp4',
      path: 'media/proof.mp4',
      artifactHash: sha256(source),
      provenance: { sources: [] },
    }],
  }, null, 2)}\n`);

  const first = run(['qa', 'prepare', 'proof-video', '--project', root, '--id', 'proof-review', '--samples', '5']);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.match(first.stdout, /Samples: 5/);
  const packetPath = path.join(root, '.demoweave', 'cache', 'qa', 'proof-review', 'packet.json');
  const contactPath = path.join(root, '.demoweave', 'cache', 'qa', 'proof-review', 'contact-sheet.png');
  const reportPath = path.join(root, '.demoweave', 'qa', 'reports', 'proof-review.json');
  const packet = JSON.parse(await fs.readFile(packetPath, 'utf8'));
  assert.equal(packet.sampling.samples.length, 5);
  assert.equal(packet.source.evidenceId, 'proof-video');
  assert.ok(packet.sampling.samples.every((sample) => /^sha256:[0-9a-f]{64}$/.test(sample.artifactHash)));
  const contact = await fs.readFile(contactPath);
  assert.deepEqual([...contact.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const firstPacketBytes = await fs.readFile(packetPath);

  const second = run(['qa', 'prepare', 'proof-video', '--project', root, '--id', 'proof-review', '--samples', '5']);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.match(second.stdout, /existing report preserved/);
  assert.deepEqual(await fs.readFile(packetPath), firstPacketBytes);

  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  report.verdict = 'pass';
  report.findings = [{
    id: 'smoke-note',
    severity: 'info',
    category: 'other',
    message: 'CI smoke verifies report binding and finalization; human/agent visual judgment is covered by the real M10 dogfood review.',
    sampleId: 'frame-003',
  }];
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const finalized = run(['qa', 'finalize', 'proof-review', '--project', root]);
  assert.equal(finalized.status, 0, `${finalized.stdout}\n${finalized.stderr}`);
  assert.match(finalized.stdout, /Verdict: PASS/);
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8'));
  const qaEvidence = manifest.evidence.find((item) => item.id === 'proof-review-report');
  assert.ok(qaEvidence);
  assert.deepEqual(qaEvidence.derivedFrom, ['proof-video']);
  assert.equal(qaEvidence.producer.kind, 'agent');
  assert.equal(qaEvidence.producer.id, 'visual-qa');

  await fs.appendFile(path.join(root, 'media', 'proof.mp4'), Buffer.from('changed'));
  const changed = run(['qa', 'prepare', 'proof-video', '--project', root, '--id', 'changed-review', '--samples', '3']);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /QA_SOURCE_HASH_MISMATCH/);

  console.log('M10 visual QA smoke passed: deterministic MP4 sampling/contact sheet -> agent report binding -> finalized QA Evidence.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
