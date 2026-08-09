import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { analyzeProject } from './analyzer.js';

const fixtures = path.resolve(process.cwd(), '../../fixtures');

test('detects CLI fixture', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'cli'));
  assert.ok(profile.surfaces.some((s) => s.type === 'terminal' && s.command === 'fixture-cli'));
});

test('detects web fixture', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'web'));
  assert.ok(profile.surfaces.some((s) => s.type === 'web'));
  assert.ok(profile.frameworks.some((f) => f.name === 'Next.js'));
});

test('detects library fixture', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'library'));
  assert.ok(profile.surfaces.some((s) => s.type === 'library'));
});
