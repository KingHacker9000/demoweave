import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const repository = path.resolve(import.meta.dirname, '..');
const cli = path.join(repository, 'packages', 'cli', 'dist', 'index.js');
const reviewId = 'terminal-web-proof-review';
const reviewedSourceHash = 'sha256:e1e12fd17042c361fdd6b4025e52a4ba3ba7829fdd7c2b6a945ff8fcef924952';
const packetPath = path.join(repository, '.demoweave', 'cache', 'qa', reviewId, 'packet.json');
const reportPath = path.join(repository, '.demoweave', 'qa', 'reports', `${reviewId}.json`);

const packet = JSON.parse(await fs.readFile(packetPath, 'utf8'));
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));

assert.equal(packet.id, reviewId);
assert.equal(packet.source.evidenceId, 'terminal-web-proof-mp4');
assert.equal(
  packet.source.artifactHash,
  reviewedSourceHash,
  'terminal-web-proof changed after the M10 visual review; inspect the new packet and update this reviewed hash/findings instead of inheriting the old PASS'
);
assert.equal(packet.source.width, 1920);
assert.equal(packet.source.height, 720);
assert.equal(packet.source.durationMs, 5000);
assert.equal(packet.sampling.samples.length, 7);
assert.equal(report.packetId, packet.id);
assert.equal(report.sourceEvidenceId, packet.source.evidenceId);
assert.equal(report.sourceArtifactHash, packet.source.artifactHash);

const freeze = packet.signals.find((signal) => signal.kind === 'freeze-range');
assert.ok(freeze, 'expected the reviewed proof to expose its intentional final static hold as a freeze-range signal');
assert.ok(freeze.startMs >= 2400 && freeze.startMs <= 2900, `unexpected final-hold start: ${freeze.startMs}ms`);
assert.equal(freeze.endMs, 5000);

report.verdict = 'pass';
report.findings = [
  {
    id: 'readable-split-layout',
    severity: 'info',
    category: 'readability',
    message: 'The sampled split composition keeps the terminal and browser panes readable, correctly proportioned, and unclipped.',
    sampleId: 'frame-004'
  },
  {
    id: 'intentional-final-hold',
    severity: 'info',
    category: 'dead-time',
    message: 'The final static range is an intentional reading hold after the terminal reveal, not accidental dead time.',
    sampleId: 'frame-007',
    startMs: freeze.startMs,
    endMs: freeze.endMs
  },
  {
    id: 'static-browser-pane',
    severity: 'info',
    category: 'composition',
    message: 'The browser pane remains intentionally static throughout the proof; it is a captured screenshot and is not presented as browser interaction recording.',
    sampleId: 'frame-007'
  },
  {
    id: 'no-visible-leak',
    severity: 'info',
    category: 'secret',
    message: 'The reviewed samples show no browser chrome, username/home path, machine-specific absolute path, notification, or visible secret.',
    sampleId: 'frame-007'
  }
];

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const finalized = spawnSync(process.execPath, [cli, 'qa', 'finalize', reviewId, '--project', repository], {
  cwd: repository,
  encoding: 'utf8',
  shell: false
});
assert.equal(finalized.status, 0, `${finalized.stdout}\n${finalized.stderr}`);
assert.match(finalized.stdout, /Verdict: PASS/);
assert.match(finalized.stdout, /Evidence: terminal-web-proof-review-report/);

console.log(`M10 dogfood review passed against ${packet.source.artifactHash}: 7 sampled frames, intentional final hold acknowledged, split composition visually approved.`);
