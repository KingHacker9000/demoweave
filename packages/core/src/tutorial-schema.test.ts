import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { TutorialPlanSchema } from './tutorial.js';

const repository = path.resolve(process.cwd(), '../..');

const fixture = {
  schemaVersion: 1,
  id: 'proof-tutorial',
  video: { evidenceId: 'proof-video' },
  metadata: {
    title: 'DemoWeave proof',
    description: 'A deterministic tutorial package.',
    language: 'en',
  },
  thumbnail: {
    atMs: 1000,
    width: 1280,
    height: 720,
    fit: 'cover',
    background: '#0b0d14',
  },
  captions: [{ id: 'intro', startMs: 0, endMs: 900, text: 'Runtime evidence.' }],
  chapters: [{ startMs: 0, title: 'Proof' }],
};

test('published TutorialPlan v1 schema exposes the runtime primary shape', async () => {
  assert.equal(TutorialPlanSchema.safeParse(fixture).success, true);
  const published = JSON.parse(await fs.readFile(path.join(repository, 'schemas', 'tutorial.schema.json'), 'utf8'));
  assert.equal(published.properties.schemaVersion.const, 1);
  assert.deepEqual(published.properties.thumbnail.properties.fit.enum, ['contain', 'cover']);
  assert.equal(published.properties.thumbnail.properties.width.multipleOf, 2);
  assert.equal(published.properties.thumbnail.properties.height.multipleOf, 2);
  assert.equal(published.properties.captions.minItems, 1);
  assert.equal(published.properties.chapters.minItems, 1);
  assert.equal(published.$defs.stableId.pattern, '^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$');
});
