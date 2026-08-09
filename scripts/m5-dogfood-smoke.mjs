import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const cli = path.join(root, 'packages', 'cli', 'dist', 'index.js');
const targetRelative = 'docs/M5_DOGFOOD.md';
const planRelative = '.demoweave/plans/m5-dogfood.json';
const target = path.join(root, targetRelative);
const original = await fs.readFile(target, 'utf8');
const expected = "# M5 dogfood\n\nThis file is a small real Markdown target used by DemoWeave's own M5 smoke workflow.\n\n## Review state\n\nThe reviewed patch was applied successfully in the disposable CI working tree.\n";

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

try {
  const inspection = run(['docs', 'inspect', targetRelative, '--json']);
  assert.equal(inspection.status, 0, inspection.stderr);
  const inspected = JSON.parse(inspection.stdout);
  assert.equal(inspected.baseHash, 'sha256:e9c43f6fff1fdc388df338065f4a3c7b6f64e7d4fecbd427f1c2a93ffc597400');
  assert.ok(inspected.sections.some((section) => section.id === 'section:m5-dogfood/review-state'));

  const preview = run(['docs', 'preview', planRelative, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const reviewed = JSON.parse(preview.stdout);
  assert.match(reviewed.reviewToken, /^review-v1:[0-9a-f]{64}$/);
  assert.equal(reviewed.candidate, expected);
  assert.equal(await fs.readFile(target, 'utf8'), original, 'preview must not mutate the repository document');

  const apply = run(['docs', 'apply', planRelative, '--review', reviewed.reviewToken]);
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal(await fs.readFile(target, 'utf8'), expected);

  const staleApply = run(['docs', 'apply', planRelative, '--review', reviewed.reviewToken]);
  assert.notEqual(staleApply.status, 0);
  assert.match(staleApply.stderr, /STALE_BASE/);

  console.log(`M5 dogfood passed with ${reviewed.reviewToken}`);
} finally {
  await fs.writeFile(target, original, 'utf8');
}
