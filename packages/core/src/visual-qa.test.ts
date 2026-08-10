import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualQAPacketSchema, VisualQAReportSchema } from './visual-qa.js';

function packet() {
  return {
    schemaVersion: 1,
    id: 'terminal-web-proof-review',
    source: {
      evidenceId: 'terminal-web-proof-mp4',
      path: 'docs-media/terminal-web-proof.mp4',
      format: 'mp4',
      artifactHash: `sha256:${'a'.repeat(64)}`,
      width: 1920,
      height: 720,
      durationMs: 5000,
    },
    sampling: {
      strategy: 'uniform',
      requestedCount: 3,
      samples: [
        { id: 'frame-001', atMs: 0, path: '.demoweave/cache/qa/terminal-web-proof-review/frame-001.png', artifactHash: `sha256:${'b'.repeat(64)}`, width: 1920, height: 720 },
        { id: 'frame-002', atMs: 2500, path: '.demoweave/cache/qa/terminal-web-proof-review/frame-002.png', artifactHash: `sha256:${'c'.repeat(64)}`, width: 1920, height: 720 },
        { id: 'frame-003', atMs: 4950, path: '.demoweave/cache/qa/terminal-web-proof-review/frame-003.png', artifactHash: `sha256:${'d'.repeat(64)}`, width: 1920, height: 720 },
      ],
    },
    contactSheet: {
      path: '.demoweave/cache/qa/terminal-web-proof-review/contact-sheet.png',
      artifactHash: `sha256:${'e'.repeat(64)}`,
      width: 1280,
      height: 760,
    },
    signals: [],
  };
}

function report() {
  return {
    schemaVersion: 1,
    id: 'terminal-web-proof-review',
    packetId: 'terminal-web-proof-review',
    packetHash: `sha256:${'f'.repeat(64)}`,
    sourceEvidenceId: 'terminal-web-proof-mp4',
    sourceArtifactHash: `sha256:${'a'.repeat(64)}`,
    verdict: 'pending',
    findings: [],
  };
}

test('accepts a deterministic VisualQAPacket v1 for MP4 Evidence', () => {
  assert.equal(VisualQAPacketSchema.safeParse(packet()).success, true);
});

test('requires duration for animated media and forbids it for PNG', () => {
  const missing = packet();
  delete (missing.source as any).durationMs;
  assert.equal(VisualQAPacketSchema.safeParse(missing).success, false);

  const png = packet();
  png.source.format = 'png';
  delete (png.source as any).durationMs;
  png.sampling.samples = [{ ...png.sampling.samples[0]!, atMs: 0 }];
  png.sampling.requestedCount = 1;
  assert.equal(VisualQAPacketSchema.safeParse(png).success, true);

  (png.source as any).durationMs = 5000;
  assert.equal(VisualQAPacketSchema.safeParse(png).success, false);
});

test('packet rejects duplicate samples and out-of-range timestamps', () => {
  const duplicate = packet();
  duplicate.sampling.samples[1]!.id = 'frame-001';
  assert.equal(VisualQAPacketSchema.safeParse(duplicate).success, false);

  const outside = packet();
  outside.sampling.samples[2]!.atMs = 5000;
  assert.equal(VisualQAPacketSchema.safeParse(outside).success, false);
});

test('packet rejects unsafe paths and invalid signal ranges', () => {
  const unsafe = packet();
  unsafe.source.path = '../outside.mp4';
  assert.equal(VisualQAPacketSchema.safeParse(unsafe).success, false);

  const signal = packet();
  signal.signals = [{ id: 'freeze-1', kind: 'freeze-range', startMs: 3000, endMs: 2500 }];
  assert.equal(VisualQAPacketSchema.safeParse(signal).success, false);
});

test('accepts a pending durable VisualQAReport v1 bound to a packet/source hash', () => {
  assert.equal(VisualQAReportSchema.safeParse(report()).success, true);
});

test('report validates verdict/finding severity relationships', () => {
  const needs = report();
  needs.verdict = 'needs-changes';
  needs.findings = [{ id: 'note', severity: 'info', category: 'other', message: 'Informational only.' }];
  assert.equal(VisualQAReportSchema.safeParse(needs).success, false);

  const pass = report();
  pass.verdict = 'pass';
  pass.findings = [{ id: 'bad', severity: 'error', category: 'readability', message: 'Unreadable.' }];
  assert.equal(VisualQAReportSchema.safeParse(pass).success, false);

  const valid = report();
  valid.verdict = 'needs-changes';
  valid.findings = [{
    id: 'clipped-title',
    severity: 'error',
    category: 'clipping',
    message: 'The title is clipped in the final sample.',
    sampleId: 'frame-003',
    startMs: 4500,
    endMs: 4950,
    recommendation: 'Increase lower padding before rendering again.',
  }];
  assert.equal(VisualQAReportSchema.safeParse(valid).success, true);
});

test('report rejects duplicate finding ids and incomplete time ranges', () => {
  const duplicate = report();
  duplicate.findings = [
    { id: 'same', severity: 'info', category: 'other', message: 'One.' },
    { id: 'same', severity: 'warning', category: 'composition', message: 'Two.' },
  ];
  assert.equal(VisualQAReportSchema.safeParse(duplicate).success, false);

  const range = report();
  range.findings = [{ id: 'range', severity: 'info', category: 'other', message: 'Range.', startMs: 1000 }];
  assert.equal(VisualQAReportSchema.safeParse(range).success, false);
});
