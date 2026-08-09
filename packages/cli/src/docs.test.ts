import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectMarkdown } from '@demoweave/core';

const cli = path.join(process.cwd(), 'dist', 'index.js');

async function fixture(context: test.TestContext, source = '# Demo\n\nOld body.\n'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-docs-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'plans'), { recursive: true });
  await fs.writeFile(path.join(root, 'README.md'), source);
  return root;
}

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

async function writePlan(root: string, source: string, name = 'readme.json'): Promise<string> {
  const relative = `.demoweave/plans/${name}`;
  const plan = {
    schemaVersion: 1,
    id: 'improve-readme',
    target: 'README.md',
    baseHash: inspectMarkdown(source, 'README.md').contentHash,
    operations: [{
      id: 'edit-demo',
      type: 'edit',
      sectionId: 'section:demo',
      markdown: '\nNew body.\n',
    }],
  };
  await fs.writeFile(path.join(root, ...relative.split('/')), `${JSON.stringify(plan, null, 2)}\n`);
  return relative;
}

test('docs inspect provides concise human output and structured agent JSON', async (context) => {
  const root = await fixture(context, 'Before\n\n# Demo\n\nBody\n');
  const human = run(['docs', 'inspect', 'README.md', '--project', root]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Document: README\.md/);
  assert.match(human.stdout, /Content hash: sha256:[a-f0-9]{64}/);
  assert.match(human.stdout, /preamble/);
  assert.match(human.stdout, /section:demo/);

  const json = run(['docs', 'inspect', 'README.md', '--project', root, '--json']);
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.target, 'README.md');
  assert.equal(parsed.sections[1].heading, 'Demo');
  assert.equal(parsed.sections[1].directBodyRange.start.line, 4);
  assert.equal(String(parsed.contentHash).startsWith('sha256:'), true);
  assert.equal(JSON.stringify(parsed).includes(root), false);
});

test('docs preview is deterministic and non-mutating, apply requires its exact token', async (context) => {
  const source = '# Demo\n\nOld body.\n';
  const root = await fixture(context, source);
  const planPath = await writePlan(root, source);

  const first = run(['docs', 'preview', planPath, '--project', root]);
  const second = run(['docs', 'preview', planPath, '--project', root]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /Document plan: improve-readme/);
  assert.match(first.stdout, /Operations:\n  ~ edit Demo/);
  assert.match(first.stdout, /-Old body\./);
  assert.match(first.stdout, /\+New body\./);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), source);
  const token = first.stdout.match(/Review token:\s*(sha256:[a-f0-9]{64})/)?.[1];
  assert.ok(token);

  const wrong = run(['docs', 'apply', planPath, '--project', root, '--review', 'sha256:bad']);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /REVIEW_TOKEN_MISMATCH:/);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), source);

  const applied = run(['docs', 'apply', planPath, '--project', root, '--review', token]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Applied document plan: improve-readme/);
  assert.match(applied.stdout, /CHANGED\s+edit Demo/);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# Demo\n\nNew body.\n');
});

test('docs apply refuses stale documents and changed plans after preview', async (context) => {
  const source = '# Demo\n\nOld body.\n';
  const root = await fixture(context, source);
  const planPath = await writePlan(root, source);
  const preview = run(['docs', 'preview', planPath, '--project', root, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const token = JSON.parse(preview.stdout).reviewToken as string;

  const planFile = path.join(root, ...planPath.split('/'));
  const changedPlan = JSON.parse(await fs.readFile(planFile, 'utf8'));
  changedPlan.operations[0].markdown = '\nDifferent body.\n';
  await fs.writeFile(planFile, `${JSON.stringify(changedPlan, null, 2)}\n`);
  const planMismatch = run(['docs', 'apply', planPath, '--project', root, '--review', token]);
  assert.equal(planMismatch.status, 1);
  assert.match(planMismatch.stderr, /REVIEW_TOKEN_MISMATCH:/);

  await writePlan(root, source);
  await fs.writeFile(path.join(root, 'README.md'), `${source}Changed externally.\n`);
  const stale = run(['docs', 'apply', planPath, '--project', root, '--review', token]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /STALE_DOCUMENT_PLAN:/);
});

test('docs discard deletes only the plan and traversal errors are non-zero', async (context) => {
  const source = '# Demo\n\nOld body.\n';
  const root = await fixture(context, source);
  const planPath = await writePlan(root, source);
  const targetBefore = await fs.readFile(path.join(root, 'README.md'));
  const discarded = run(['docs', 'discard', planPath, '--project', root]);
  assert.equal(discarded.status, 0, discarded.stderr);
  assert.match(discarded.stdout, /Discarded document plan/);
  await assert.rejects(fs.access(path.join(root, ...planPath.split('/'))));
  assert.deepEqual(await fs.readFile(path.join(root, 'README.md')), targetBefore);

  const missing = run(['docs', 'discard', planPath, '--project', root]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /DOCUMENT_PLAN_NOT_FOUND:/);
  const traversal = run(['docs', 'inspect', '..\\secret.md', '--project', root, '--json']);
  assert.equal(traversal.status, 1);
  assert.match(traversal.stderr, /UNSAFE_DOCUMENT_TARGET:/);
});

test('init creates the normal DocumentPlan directory', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-init-docs-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const initialized = run(['init', root]);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Document plans:/);
  assert.equal((await fs.stat(path.join(root, '.demoweave', 'plans'))).isDirectory(), true);
});
