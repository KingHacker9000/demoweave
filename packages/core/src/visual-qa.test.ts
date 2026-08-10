import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualQAReportSchema } from './visual-qa.js';

function report() {
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
        { id: 'frame-001', atMs: 0, path: '.demoweave/qa/terminal-web-proof-review/frame-001.png', artifactHash: `sha256:${'b'.repeat(64)}`, width: 1920, height: 720 },
        { id: 'frame-002', atMs: 2500, path: '.demoweave/qa/terminal-web-proof-review/frame-002.png', artifactHash: `sha256:${'c'.repeat(64)}`, width: 1920, height: 720 },
        { id: 'frame-003', atMs: 4950, path: '.demoweave/qa/terminal-web-proof-review/frame-003.png', artifactHash: `sha256:${'d'.repeat(64)}`, width: 1920, height: 720 },
      ],
    },
    signals: [],
    verdict: 'pending',
    findings: [],
  };
}

test('accepts a pending VisualQAReport v1 prepared from MP4 Evidence', () => {
  assert.equal(VisualQAReportSchema.safeParse(report()).success, true);
});

test('requires duration for animated media and forbids it for PNG', () => {
  const missing = report();
  delete (missing.source as any).durationMs;
  assert.equal(VisualQAReportSchema.safeParse(missing).success, false);

  const png = report();
  png.source.format = 'png';
  delete (png.source as any).durationMs;
  png.sampling.samples = [png.sampling.samples[0]!];
  png.sampling.requestedCount = 1;
  assert.equal(VisualQAReportSchema.safeParse(png).success, true);

  (png.source as any).durationMs = 5000;
  assert.equal(VisualQAReportSchema.safeParse(png).success, false);
});

test('rejects duplicate samples and out-of-range timestamps', () => {
  const duplicate = report();
  duplicate.sampling.samples[1]!.id = 'frame-001';
  assert.equal(VisualQAReportSchema.safeParse(duplicate).success, false);

  const outside = report();
  outside.sampling.samples[2]!.atMs = 5000;
  assert.equal(VisualQAReportSchema.safeParse(outside).success, false);
});

test('validates agent findings against prepared samples and source duration', () => {
  const reviewed = report();
  reviewed.verdict = 'needs-changes';
  reviewed.findings = [{
    id: 'clipped-title',
    severity: 'error',
    category: 'clipping',
    message: 'The title is clipped in the final frame.',
    sampleId: 'frame-003',
    startMs: 4500,
    endMs: 4950,
    recommendation: 'Increase lower padding before rendering again.',
  }];
  assert.equal(VisualQAReportSchema.safeParse(reviewed).success, true);

  reviewed.findings[0]!.sampleId = 'missing-frame';
  assert.equal(VisualQAReportSchema.safeParse(reviewed).success, false);
});

test('a passing report cannot contain error findings', () => {
  const reviewed = report();
  reviewed.verdict = 'pass';
  reviewed.findings = [{ id: 'bad', severity: 'error', category: 'readability', message: 'Unreadable.' }];
  assert.equal(VisualQAReportSchema.safeParse(reviewed).success, false);
});

test('needs-changes requires a warning/error while pass may contain info findings', () => {
  const needs = report();
  needs.verdict = 'needs-changes';
  needs.findings = [{ id: 'note', severity: 'info', category: 'other', message: 'Informational only.' }];
  assert.equal(VisualQAReportSchema.safeParse(needs).success, false);

  const pass = report();
  pass.verdict = 'pass';
  pass.findings = [{ id: 'note', severity: 'info', category: 'other', message: 'Presentation is intentionally static here.' }];
  assert.equal(VisualQAReportSchema.safeParse(pass).success, true);
});

test('rejects unsafe project-relative paths and invalid signal ranges', () => {
  const unsafe = report();
  unsafe.source.path = '../outside.mp4';
  assert.equal(VisualQAReportSchema.safeParse(unsafe).success, false);

  const signal = report();
  signal.signals = [{ id: 'freeze-1', kind: 'freeze-range', startMs: 3000, endMs: 2500 }];
  assert.equal(VisualQAReportSchema.safeParse(signal).success, false);
});
