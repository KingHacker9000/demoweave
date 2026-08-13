import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repository = process.cwd();
const cli = path.join(repository, 'packages', 'cli', 'dist', 'index.js');
const fixture = path.join(repository, 'fixtures', 'publisher-markdown');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-m15-publisher-'));
const project = path.join(root, 'publisher-markdown');

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: repository, encoding: 'utf8', shell: false });
}

function json(args) {
  const result = run([...args, '--json']);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

try {
  await fs.cp(fixture, project, { recursive: true });
  await fs.rm(path.join(project, '.demoweave', 'publications'), { recursive: true, force: true });
  for (const target of ['README.md', 'guide', 'docs-media']) await fs.rm(path.join(project, 'published', target), { recursive: true, force: true });
  const sourcePaths = ['README.md', 'docs/getting-started.md', 'docs-media/proof.svg'];
  const sourceBefore = new Map(await Promise.all(sourcePaths.map(async (file) => [file, await fs.readFile(path.join(project, file))])));
  const keepBefore = await fs.readFile(path.join(project, 'published', 'keep-me.txt'));

  const preview = json(['publish', 'preview', 'markdown-proof', '--project', project]);
  assert.deepEqual(preview.update, []);
  assert.equal(preview.create.length, 3);
  assert.match(preview.reviewToken, /^publish-review-v1:[0-9a-f]{64}$/);
  await assert.rejects(fs.access(path.join(project, 'published', 'README.md')));

  const wrong = run(['publish', 'apply', 'markdown-proof', '--project', project, '--review-token', `publish-review-v1:${'0'.repeat(64)}`]);
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /PUBLICATION_REVIEW_MISMATCH/);
  await assert.rejects(fs.access(path.join(project, 'published', 'README.md')));

  const applied = json(['publish', 'apply', 'markdown-proof', '--project', project, '--review-token', preview.reviewToken]);
  assert.equal(applied.writes, 4);
  assert.match(await fs.readFile(path.join(project, 'published', 'README.md'), 'utf8'), /guide\/getting-started\.md\?mode=quick#first-run/);
  assert.match(await fs.readFile(path.join(project, 'published', 'README.md'), 'utf8'), /https:\/\/github\.com\/KingHacker9000\/demoweave/);
  assert.equal((await fs.readFile(path.join(project, 'published', 'keep-me.txt'))).equals(keepBefore), true);
  assert.equal(json(['publish', 'status', 'markdown-proof', '--project', project]).state, 'fresh');

  await fs.appendFile(path.join(project, 'README.md'), '\nsource mutation\n');
  let status = json(['publish', 'status', 'markdown-proof', '--project', project]);
  assert.equal(status.state, 'stale');
  assert.equal(status.reasons.some((reason) => reason.code === 'source-changed'), true);
  await fs.writeFile(path.join(project, 'README.md'), sourceBefore.get('README.md'));

  await fs.appendFile(path.join(project, 'docs-media', 'proof.svg'), '\n<!-- dependency mutation -->\n');
  status = json(['publish', 'status', 'markdown-proof', '--project', project]);
  assert.equal(status.state, 'stale');
  assert.equal(status.reasons.some((reason) => reason.code === 'dependency-changed'), true);
  await fs.writeFile(path.join(project, 'docs-media', 'proof.svg'), sourceBefore.get('docs-media/proof.svg'));

  const publishedReadme = await fs.readFile(path.join(project, 'published', 'README.md'));
  await fs.appendFile(path.join(project, 'published', 'README.md'), '\ntarget drift\n');
  assert.equal(json(['publish', 'status', 'markdown-proof', '--project', project]).state, 'drifted');
  await fs.writeFile(path.join(project, 'published', 'README.md'), publishedReadme);
  await fs.rm(path.join(project, 'published', 'README.md'));
  assert.equal(json(['publish', 'status', 'markdown-proof', '--project', project]).state, 'missing');
  await fs.writeFile(path.join(project, 'published', 'README.md'), publishedReadme);

  await fs.appendFile(path.join(project, 'README.md'), '\n[Not selected](docs/not-selected.md)\n');
  await fs.writeFile(path.join(project, 'docs', 'not-selected.md'), '# Not selected\n');
  const unresolved = run(['publish', 'preview', 'markdown-proof', '--project', project, '--json']);
  assert.notEqual(unresolved.status, 0);
  assert.match(unresolved.stderr, /not explicitly included in PublisherPlan/);
  await fs.writeFile(path.join(project, 'README.md'), sourceBefore.get('README.md'));
  await fs.rm(path.join(project, 'docs', 'not-selected.md'));

  const targetBefore = new Map(await Promise.all([
    'published/README.md',
    'published/guide/getting-started.md',
    'published/docs-media/proof.svg',
    'published/keep-me.txt',
  ].map(async (file) => [file, hash(await fs.readFile(path.join(project, file)))])));
  const manifestPath = path.join(project, '.demoweave', 'publications', 'markdown-proof.json');
  const manifestBefore = await fs.readFile(manifestPath);
  const unchanged = json(['publish', 'preview', 'markdown-proof', '--project', project]);
  assert.equal(unchanged.unchanged.length, 3);
  const reapplied = json(['publish', 'apply', 'markdown-proof', '--project', project, '--review-token', unchanged.reviewToken]);
  assert.equal(reapplied.writes, 0);
  assert.equal((await fs.readFile(manifestPath)).equals(manifestBefore), true);
  for (const [file, before] of targetBefore) assert.equal(hash(await fs.readFile(path.join(project, file))), before);
  for (const [file, before] of sourceBefore) assert.equal((await fs.readFile(path.join(project, file))).equals(before), true);

  console.log('M15A publisher smoke passed: zero-write preview/wrong-token, reviewed apply, fresh/stale/dependency/drift/missing/unresolved states, unrelated-file preservation, no-churn, and source-byte preservation.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
