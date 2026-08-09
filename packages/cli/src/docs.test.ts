import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cli = path.join(process.cwd(), 'dist', 'index.js');

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('docs inspect -> preview -> reviewed apply works through the built CLI', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-docs-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'plans'), { recursive: true });
  const source = '# Intro\nold body\n# Keep\nuntouched\n';
  await fs.writeFile(path.join(root, 'README.md'), source);

  const inspected = run(['docs', 'inspect', 'README.md', '--project', root, '--json']);
  assert.equal(inspected.status, 0, inspected.stderr);
  const inspection = JSON.parse(inspected.stdout) as any;
  const intro = inspection.sections.find((section: any) => section.heading === 'Intro');
  assert.ok(intro?.id);

  const planPath = path.join(root, '.demoweave', 'plans', 'readme.json');
  await fs.writeFile(planPath, `${JSON.stringify({
    schemaVersion: 1,
    id: 'cli-readme',
    targetPath: 'README.md',
    baseHash: inspection.baseHash,
    operations: [{ id: 'edit-intro', type: 'edit', selector: { sectionId: intro.id }, markdown: 'new body\n' }],
  }, null, 2)}\n`);

  const previewed = run(['docs', 'preview', '.demoweave/plans/readme.json', '--project', root, '--json']);
  assert.equal(previewed.status, 0, previewed.stderr);
  const preview = JSON.parse(previewed.stdout) as any;
  assert.match(preview.reviewToken, /^review-v1:[0-9a-f]{64}$/);
  assert.match(preview.diff, /-old body/);
  assert.match(preview.diff, /\+new body/);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), source);

  const applied = run(['docs', 'apply', '.demoweave/plans/readme.json', '--project', root, '--review', preview.reviewToken]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Applied plan: cli-readme/);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# Intro\nnew body\n# Keep\nuntouched\n');
});

test('docs apply refuses an unreviewed candidate and docs discard never mutates the target', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-docs-safety-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'plans'), { recursive: true });
  const source = '# Safe\nbody\n';
  await fs.writeFile(path.join(root, 'README.md'), source);

  const inspected = run(['docs', 'inspect', 'README.md', '--project', root, '--json']);
  assert.equal(inspected.status, 0, inspected.stderr);
  const inspection = JSON.parse(inspected.stdout) as any;
  const section = inspection.sections.find((item: any) => item.heading === 'Safe');
  await fs.writeFile(path.join(root, '.demoweave', 'plans', 'safe.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'safe-plan',
    targetPath: 'README.md',
    baseHash: inspection.baseHash,
    operations: [{ id: 'keep', type: 'preserve', selector: { sectionId: section.id } }],
  }, null, 2)}\n`);

  const wrong = run(['docs', 'apply', '.demoweave/plans/safe.json', '--project', root, '--review', 'review-v1:not-reviewed']);
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /REVIEW_MISMATCH/);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), source);

  const discarded = run(['docs', 'discard', '.demoweave/plans/safe.json', '--project', root]);
  assert.equal(discarded.status, 0, discarded.stderr);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), source);
  await assert.rejects(() => fs.access(path.join(root, '.demoweave', 'plans', 'safe.json')));
});
