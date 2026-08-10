import assert from 'node:assert/strict';
import test from 'node:test';
import { TutorialPlanSchema } from './tutorial.js';

function validPlan() {
  return {
    schemaVersion: 1,
    id: 'demoweave-overview',
    video: { evidenceId: 'terminal-web-proof-mp4' },
    metadata: {
      title: 'DemoWeave overview',
      description: 'A short evidence-driven DemoWeave walkthrough.',
      language: 'en-US',
      tags: ['documentation', 'developer-tools'],
    },
    thumbnail: {
      atMs: 2500,
      width: 1280,
      height: 720,
      fit: 'cover',
      background: '#0b0d14',
      title: 'DemoWeave',
      subtitle: 'Evidence-driven documentation',
    },
    captions: [
      { id: 'intro', startMs: 0, endMs: 2200, text: 'DemoWeave grounds documentation in runtime evidence.' },
      { id: 'proof', startMs: 2300, endMs: 4900, text: 'Independent terminal and browser evidence can be composed without desktop recording.' },
    ],
    chapters: [{ startMs: 0, title: 'DemoWeave proof' }],
  };
}

test('accepts a deterministic TutorialPlan v1', () => {
  const parsed = TutorialPlanSchema.parse(validPlan());
  assert.equal(parsed.id, 'demoweave-overview');
  assert.equal(parsed.video.evidenceId, 'terminal-web-proof-mp4');
  assert.equal(parsed.thumbnail.width, 1280);
  assert.equal(parsed.captions.length, 2);
});

test('rejects unsupported schema versions and invalid stable ids', () => {
  assert.equal(TutorialPlanSchema.safeParse({ ...validPlan(), schemaVersion: 2 }).success, false);
  assert.equal(TutorialPlanSchema.safeParse({ ...validPlan(), id: 'Demo Weave' }).success, false);
});

test('rejects duplicate, overlapping, or reversed caption cues', () => {
  const duplicate = validPlan();
  duplicate.captions[1]!.id = 'intro';
  assert.equal(TutorialPlanSchema.safeParse(duplicate).success, false);

  const overlap = validPlan();
  overlap.captions[1]!.startMs = 2000;
  assert.equal(TutorialPlanSchema.safeParse(overlap).success, false);

  const reversed = validPlan();
  reversed.captions[0]!.endMs = 0;
  assert.equal(TutorialPlanSchema.safeParse(reversed).success, false);
});

test('requires chapter zero and strictly increasing chapter times', () => {
  const missingZero = validPlan();
  missingZero.chapters = [{ startMs: 1000, title: 'Late start' }];
  assert.equal(TutorialPlanSchema.safeParse(missingZero).success, false);

  const unordered = validPlan();
  unordered.chapters = [
    { startMs: 0, title: 'Intro' },
    { startMs: 3000, title: 'Proof' },
    { startMs: 2500, title: 'Wrap' },
  ];
  assert.equal(TutorialPlanSchema.safeParse(unordered).success, false);
});

test('rejects duplicate tags ignoring case and odd thumbnail dimensions', () => {
  const duplicateTags = validPlan();
  duplicateTags.metadata.tags = ['Demo', 'demo'];
  assert.equal(TutorialPlanSchema.safeParse(duplicateTags).success, false);

  const oddThumbnail = validPlan();
  oddThumbnail.thumbnail.width = 1279;
  assert.equal(TutorialPlanSchema.safeParse(oddThumbnail).success, false);
});
