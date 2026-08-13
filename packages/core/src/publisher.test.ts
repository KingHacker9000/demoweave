import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PublicationManifestSchema,
  PublisherError,
  PublisherPlanSchema,
  applyPublication,
  canonicalPublisherPlan,
  parsePublisherPlan,
  previewPublication,
  publicationStatus,
} from './publisher.js';

async function fixture(options: { readme?: string; target?: string } = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-publisher-'));
  await fs.mkdir(path.join(root, '.demoweave', 'publishers'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.writeFile(path.join(root, 'README.md'), options.readme ?? '# Home\n\n[Guide](docs/guide.md?q=1#go)\n\n![Proof](media/proof.svg)\n\n[Remote](https://example.com/docs)\n');
  await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n\n<a href="../README.md">Home</a>\n\n<img src="../media/proof.svg?raw=1#proof">\n');
  await fs.writeFile(path.join(root, 'media', 'proof.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  await fs.writeFile(path.join(root, '.demoweave', 'publishers', 'proof.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'proof',
    publisher: 'markdown',
    targetRoot: 'published',
    entries: [
      { source: 'README.md', destination: 'README.md' },
      { source: 'docs/guide.md', destination: 'guide/start.md' },
    ],
  }, null, 2)}\n`);
  if (options.target !== undefined) {
    await fs.mkdir(path.join(root, 'published'), { recursive: true });
    await fs.writeFile(path.join(root, 'published', 'README.md'), options.target);
  }
  return root;
}

async function writePlan(root: string, plan: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(root, '.demoweave', 'publishers', 'proof.json'), `${JSON.stringify(plan, null, 2)}\n`);
}

function plan(targetRoot: string, entries: Array<{ source: string; destination: string }>): Record<string, unknown> {
  return { schemaVersion: 1, id: 'proof', publisher: 'markdown', targetRoot, entries };
}

test('PublisherPlan v1 is strict, canonical, and rejects unsafe/duplicate paths', () => {
  const valid = { schemaVersion: 1, id: 'markdown-proof', publisher: 'markdown', targetRoot: 'published', entries: [{ source: 'README.md', destination: 'README.md' }] };
  assert.equal(PublisherPlanSchema.safeParse(valid).success, true);
  assert.equal(canonicalPublisherPlan(valid), '{"entries":[{"destination":"README.md","source":"README.md"}],"id":"markdown-proof","publisher":"markdown","schemaVersion":1,"targetRoot":"published"}');
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, id: 'Not_Portable' },
    { ...valid, targetRoot: '../outside' },
    { ...valid, targetRoot: 'C:\\outside' },
    { ...valid, entries: [{ source: '/README.md', destination: 'README.md' }] },
    { ...valid, entries: [{ source: '../README.md', destination: 'README.md' }] },
    { ...valid, entries: [{ source: 'README.txt', destination: 'README.md' }] },
    { ...valid, entries: [{ source: 'README.md', destination: '../README.md' }] },
    { ...valid, entries: [{ source: 'README.md', destination: 'A.md' }, { source: 'docs/a.md', destination: 'a.md' }] },
  ]) assert.throws(() => parsePublisherPlan(invalid), PublisherError);
});

test('preview closes local dependencies, rewrites exact positions, preserves suffixes, and writes nothing', async (context) => {
  const root = await fixture();
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceBefore = await fs.readFile(path.join(root, 'README.md'));
  const preview = await previewPublication(root, 'proof');
  assert.deepEqual(preview.create, ['README.md', 'guide/start.md', 'media/proof.svg']);
  assert.equal(preview.copiedDependencies[0]?.sourcePath, 'media/proof.svg');
  assert.match(preview.diffs.find((item) => item.path === 'README.md')!.unifiedDiff, /guide\/start\.md\?q=1#go/);
  assert.match(preview.diffs.find((item) => item.path === 'README.md')!.unifiedDiff, /https:\/\/example\.com\/docs/);
  assert.equal(await fs.readFile(path.join(root, 'README.md')).then((value) => value.equals(sourceBefore)), true);
  await assert.rejects(fs.access(path.join(root, 'published', 'README.md')));
  assert.match(preview.reviewToken, /^publish-review-v1:[0-9a-f]{64}$/);
  assert.equal((await previewPublication(root, 'proof')).reviewToken, preview.reviewToken);
  assert.equal((await previewPublication(root, '.demoweave/publishers/proof.json')).reviewToken, preview.reviewToken);
});

test('apply rejects wrong/stale tokens, publishes atomically, reports freshness, and has no churn', async (context) => {
  const root = await fixture();
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceBefore = await fs.readFile(path.join(root, 'README.md'));
  const preview = await previewPublication(root, 'proof');
  await assert.rejects(() => applyPublication(root, 'proof', 'publish-review-v1:'.padEnd(82, '0')), (error: PublisherError) => error.code === 'PUBLICATION_REVIEW_MISMATCH');
  await assert.rejects(fs.access(path.join(root, 'published', 'README.md')));
  const applied = await applyPublication(root, 'proof', preview.reviewToken);
  assert.equal(applied.writes, 4);
  assert.match(await fs.readFile(path.join(root, 'published', 'README.md'), 'utf8'), /guide\/start\.md\?q=1#go/);
  assert.match(await fs.readFile(path.join(root, 'published', 'guide', 'start.md'), 'utf8'), /\.\.\/README\.md/);
  assert.equal((await publicationStatus(root, 'proof')).state, 'fresh');
  assert.equal((await fs.readFile(path.join(root, 'README.md'))).equals(sourceBefore), true);
  const targetBefore = await fs.readFile(path.join(root, 'published', 'README.md'));
  const manifestBefore = await fs.readFile(path.join(root, '.demoweave', 'publications', 'proof.json'));
  assert.equal(manifestBefore.toString('utf8').includes(root), false);
  const secondPreview = await previewPublication(root, 'proof');
  assert.deepEqual(secondPreview.unchanged, ['README.md', 'guide/start.md', 'media/proof.svg']);
  const second = await applyPublication(root, 'proof', secondPreview.reviewToken);
  assert.equal(second.writes, 0);
  assert.equal((await fs.readFile(path.join(root, 'published', 'README.md'))).equals(targetBefore), true);
  assert.equal((await fs.readFile(path.join(root, '.demoweave', 'publications', 'proof.json'))).equals(manifestBefore), true);
});

test('status distinguishes source/dependency stale, target drift, target missing, and unpublished', async (context) => {
  const root = await fixture();
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal((await publicationStatus(root, 'proof')).state, 'unpublished');
  const preview = await previewPublication(root, 'proof');
  await applyPublication(root, 'proof', preview.reviewToken);
  await fs.appendFile(path.join(root, 'README.md'), '\nchanged\n');
  let status = await publicationStatus(root, 'proof');
  assert.equal(status.state, 'stale');
  assert.equal(status.reasons.some((reason) => reason.code === 'source-changed'), true);
  await fs.writeFile(path.join(root, 'README.md'), '# Home\n\n[Guide](docs/guide.md?q=1#go)\n\n![Proof](media/proof.svg)\n\n[Remote](https://example.com/docs)\n');
  await fs.appendFile(path.join(root, 'media', 'proof.svg'), '<!-- changed -->\n');
  status = await publicationStatus(root, 'proof');
  assert.equal(status.state, 'stale');
  assert.equal(status.reasons.some((reason) => reason.code === 'dependency-changed'), true);
  await fs.writeFile(path.join(root, 'media', 'proof.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  await fs.appendFile(path.join(root, 'published', 'README.md'), '\ndrift\n');
  assert.equal((await publicationStatus(root, 'proof')).state, 'drifted');
  await fs.rm(path.join(root, 'published', 'README.md'));
  assert.equal((await publicationStatus(root, 'proof')).state, 'missing');
});

test('unresolved Markdown is explicit and remote/fragment links are ignored', async (context) => {
  const root = await fixture({ readme: '# Home\n\n[Missing](docs/missing.md) [Remote](https://example.com/x) [Here](#home)\n' });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => previewPublication(root, 'proof'), (error: PublisherError) => {
    assert.equal(error.code, 'UNRESOLVED_PUBLICATION_DEPENDENCIES');
    assert.equal(error.issues.some((issue) => issue.reference === 'docs/missing.md'), true);
    return true;
  });
});

test('unmanaged differing target conflicts while identical target is unchanged', async (context) => {
  const root = await fixture({ target: 'unmanaged\n' });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const preview = await previewPublication(root, 'proof');
  assert.equal(preview.conflicts[0]?.code, 'unmanaged-target');
  await assert.rejects(() => applyPublication(root, 'proof', preview.reviewToken), (error: PublisherError) => error.code === 'PUBLICATION_CONFLICT');
  assert.equal(await fs.readFile(path.join(root, 'published', 'README.md'), 'utf8'), 'unmanaged\n');
});

test('review token changes with source, dependency, and target baselines', async (context) => {
  const root = await fixture();
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = await previewPublication(root, 'proof');
  await fs.appendFile(path.join(root, 'README.md'), 'x');
  const source = await previewPublication(root, 'proof');
  assert.notEqual(source.reviewToken, original.reviewToken);
  await assert.rejects(() => applyPublication(root, 'proof', original.reviewToken), (error: PublisherError) => error.code === 'PUBLICATION_REVIEW_MISMATCH');
  await fs.writeFile(path.join(root, 'README.md'), '# Home\n\n[Guide](docs/guide.md?q=1#go)\n\n![Proof](media/proof.svg)\n\n[Remote](https://example.com/docs)\n');
  await fs.appendFile(path.join(root, 'media', 'proof.svg'), 'x');
  const dependency = await previewPublication(root, 'proof');
  assert.notEqual(dependency.reviewToken, original.reviewToken);
  await assert.rejects(() => applyPublication(root, 'proof', original.reviewToken), (error: PublisherError) => error.code === 'PUBLICATION_REVIEW_MISMATCH');
  await fs.writeFile(path.join(root, 'media', 'proof.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  await fs.mkdir(path.join(root, 'published'), { recursive: true });
  await fs.writeFile(path.join(root, 'published', 'README.md'), 'x');
  const target = await previewPublication(root, 'proof');
  assert.notEqual(target.reviewToken, original.reviewToken);
  await assert.rejects(() => applyPublication(root, 'proof', original.reviewToken), (error: PublisherError) => error.code === 'PUBLICATION_REVIEW_MISMATCH');
});

test('unknown publishers and unsafe dependency traversal fail without writes', async (context) => {
  const root = await fixture();
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const planPath = path.join(root, '.demoweave', 'publishers', 'proof.json');
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  plan.publisher = 'vitepress';
  await fs.writeFile(planPath, JSON.stringify(plan));
  await assert.rejects(() => previewPublication(root, 'proof'), (error: PublisherError) => error.code === 'UNKNOWN_PUBLISHER');
  plan.publisher = 'markdown';
  await fs.writeFile(planPath, JSON.stringify(plan));
  await fs.writeFile(path.join(root, 'README.md'), '# Home\n\n![Escape](../../outside.png)\n');
  await assert.rejects(() => previewPublication(root, 'proof'), (error: PublisherError) => {
    assert.equal(error.code, 'UNRESOLVED_PUBLICATION_DEPENDENCIES');
    assert.equal(error.issues.some((issue) => issue.code === 'UNSAFE_PUBLICATION_DEPENDENCY'), true);
    return true;
  });
  await assert.rejects(fs.access(path.join(root, 'published', 'README.md')));
});

test('BOM and CRLF bytes are preserved except exact local link destinations', async (context) => {
  const readme = '\uFEFF# Home\r\n\r\n[Guide](docs/guide.md)  \r\n';
  const root = await fixture({ readme });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const preview = await previewPublication(root, 'proof');
  await applyPublication(root, 'proof', preview.reviewToken);
  const published = await fs.readFile(path.join(root, 'published', 'README.md'));
  assert.equal(published.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.equal(published.toString('utf8'), '\uFEFF# Home\r\n\r\n[Guide](guide/start.md)  \r\n');
});

test('HTML anchor and image destinations are source-position rewritten when relocation requires it', async (context) => {
  const root = await fixture();
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const planPath = path.join(root, '.demoweave', 'publishers', 'proof.json');
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  plan.entries[1].destination = 'nested/guide/start.md';
  await fs.writeFile(planPath, JSON.stringify(plan));
  const preview = await previewPublication(root, 'proof');
  const diff = preview.diffs.find((item) => item.path === 'nested/guide/start.md')!.unifiedDiff;
  assert.match(diff, /href="\.\.\/\.\.\/README\.md"/);
  assert.match(diff, /src="\.\.\/\.\.\/media\/proof\.svg\?raw=1#proof"/);
});

test('publication targets cannot overlap source Markdown or DemoWeave control paths', async (context) => {
  const root = await fixture();
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const readmeBefore = await fs.readFile(path.join(root, 'README.md'));
  const planPath = path.join(root, '.demoweave', 'publishers', 'proof.json');

  await writePlan(root, plan('README-output-dir', [
    { source: 'README.md', destination: 'README.md' },
    { source: 'docs/guide.md', destination: 'guide/start.md' },
  ]));
  assert.deepEqual((await previewPublication(root, 'proof')).create, ['README.md', 'guide/start.md', 'media/proof.svg']);

  await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  await writePlan(root, plan('docs', [{ source: 'docs/guide.md', destination: 'guide.md' }]));
  await assert.rejects(() => previewPublication(root, 'proof'), (error: PublisherError) => error.code === 'PUBLICATION_TARGET_OVERLAP');
  assert.equal((await fs.readFile(path.join(root, 'docs', 'guide.md'))).equals(Buffer.from('# Guide\n')), true);

  for (const [targetRoot, destination] of [
    ['.demoweave', 'guide.md'],
    ['.demoweave/publishers', 'proof.json'],
    ['.demoweave/publications', 'proof.json'],
  ] as const) {
    await writePlan(root, plan(targetRoot, [{ source: 'docs/guide.md', destination }]));
    const controlPlanBefore = await fs.readFile(planPath);
    const controlSourceBefore = await fs.readFile(path.join(root, 'docs', 'guide.md'));
    await assert.rejects(() => previewPublication(root, 'proof'), (error: PublisherError) => error.code === 'PUBLICATION_TARGET_OVERLAP');
    assert.equal((await fs.readFile(path.join(root, 'README.md'))).equals(readmeBefore), true);
    assert.equal((await fs.readFile(path.join(root, 'docs', 'guide.md'))).equals(controlSourceBefore), true);
    assert.equal((await fs.readFile(planPath)).equals(controlPlanBefore), true);
    await assert.rejects(fs.access(path.join(root, '.demoweave', 'publications', 'proof.json')));
  }

  await writePlan(root, plan('published', [{ source: 'docs/guide.md', destination: 'guide.md' }]));
  const oldToken = (await previewPublication(root, 'proof')).reviewToken;
  await writePlan(root, plan('docs', [{ source: 'docs/guide.md', destination: 'guide.md' }]));
  const overlappingSourceBeforeApply = await fs.readFile(path.join(root, 'docs', 'guide.md'));
  await assert.rejects(() => applyPublication(root, 'proof', oldToken), (error: PublisherError) => error.code === 'PUBLICATION_TARGET_OVERLAP');
  assert.equal((await fs.readFile(path.join(root, 'docs', 'guide.md'))).equals(overlappingSourceBeforeApply), true);
});

test('dependency and symlink-aliased targets cannot adopt source bytes', async (context) => {
  const root = await fixture({ readme: '# Home\n\n![Proof](media/proof.svg)\n' });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const readmeBefore = await fs.readFile(path.join(root, 'README.md'));
  const dependencyBefore = await fs.readFile(path.join(root, 'media', 'proof.svg'));
  try {
    await fs.symlink(root, path.join(root, 'alias'), 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
    throw error;
  }

  await writePlan(root, plan('alias', [{ source: 'README.md', destination: 'published/README.md' }]));
  await assert.rejects(() => previewPublication(root, 'proof'), (error: PublisherError) => {
    assert.equal(error.code, 'PUBLICATION_TARGET_OVERLAP');
    assert.match(error.message, /dependency asset media\/proof\.svg/);
    return true;
  });
  assert.equal((await fs.readFile(path.join(root, 'README.md'))).equals(readmeBefore), true);
  assert.equal((await fs.readFile(path.join(root, 'media', 'proof.svg'))).equals(dependencyBefore), true);

  await writePlan(root, plan('alias', [{ source: 'README.md', destination: 'README.md' }]));
  await assert.rejects(() => previewPublication(root, 'proof'), (error: PublisherError) => error.code === 'PUBLICATION_TARGET_OVERLAP');
  assert.equal((await fs.readFile(path.join(root, 'README.md'))).equals(readmeBefore), true);
});

test('rewritten Markdown and HTML paths encode filesystem segments and preserve suffix bytes', async (context) => {
  const root = await fixture({ readme: [
    '# Encoded paths',
    '',
    '![Space](media/asset%20one.svg?raw=1#proof)',
    '![Hash](media/proof%23one.svg)',
    '![Percent](media/100%25.svg)',
    '![Unicode](media/caf%C3%A9.svg)',
    '<img src="media/my%20proof.svg?raw=1#html-proof">',
    '<a href="media/proof%23one.svg#html-hash">Asset</a>',
    ...(process.platform === 'win32' ? [] : ['![Question](media/proof%3Fone.svg)']),
    '',
  ].join('\n') });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ['asset one.svg', 'proof#one.svg', '100%.svg', 'café.svg', 'my proof.svg']) {
    await fs.writeFile(path.join(root, 'media', name), `<svg data-name="${name}"/>\n`);
  }
  if (process.platform !== 'win32') await fs.writeFile(path.join(root, 'media', 'proof?one.svg'), '<svg/>\n');
  await writePlan(root, plan('published', [{ source: 'README.md', destination: 'guide/README.md' }]));

  const preview = await previewPublication(root, 'proof');
  const token = preview.reviewToken;
  await applyPublication(root, 'proof', token);
  const published = await fs.readFile(path.join(root, 'published', 'guide', 'README.md'), 'utf8');
  assert.match(published, /\.\.\/media\/asset%20one\.svg\?raw=1#proof/);
  assert.match(published, /\.\.\/media\/proof%23one\.svg/);
  assert.match(published, /\.\.\/media\/100%25\.svg/);
  assert.match(published, /\.\.\/media\/caf%C3%A9\.svg/);
  assert.match(published, /src="\.\.\/media\/my%20proof\.svg\?raw=1#html-proof"/);
  assert.match(published, /href="\.\.\/media\/proof%23one\.svg#html-hash"/);
  assert.equal(published.includes('asset one.svg'), false);
  assert.equal(published.includes('proof#one.svg'), false);
  if (process.platform !== 'win32') assert.match(published, /\.\.\/media\/proof%3Fone\.svg/);
  assert.equal((await publicationStatus(root, 'proof')).state, 'fresh');
  const manifestBefore = await fs.readFile(path.join(root, '.demoweave', 'publications', 'proof.json'));
  const noChange = await previewPublication(root, 'proof');
  assert.equal((await applyPublication(root, 'proof', noChange.reviewToken)).writes, 0);
  assert.equal((await fs.readFile(path.join(root, '.demoweave', 'publications', 'proof.json'))).equals(manifestBefore), true);
});

test('source, dependency, and target symlink escapes are rejected', async (context) => {
  const root = await fixture();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-outside-'));
  context.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); });
  await fs.writeFile(path.join(outside, 'outside.md'), '# Outside\n');
  await fs.writeFile(path.join(outside, 'outside.svg'), '<svg/>\n');
  try {
    await fs.symlink(path.join(outside, 'outside.md'), path.join(root, 'escape.md'));
    const planPath = path.join(root, '.demoweave', 'publishers', 'proof.json');
    const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
    plan.entries[0].source = 'escape.md';
    await fs.writeFile(planPath, JSON.stringify(plan));
    await assert.rejects(() => previewPublication(root, 'proof'), PublisherError);

    plan.entries[0].source = 'README.md';
    await fs.writeFile(planPath, JSON.stringify(plan));
    await fs.symlink(path.join(outside, 'outside.svg'), path.join(root, 'media', 'escape.svg'));
    await fs.writeFile(path.join(root, 'README.md'), '# Home\n\n[Guide](docs/guide.md)\n\n![Escape](media/escape.svg)\n');
    await assert.rejects(() => previewPublication(root, 'proof'), (error: PublisherError) => {
      assert.equal(error.issues.some((issue) => issue.reference === 'media/escape.svg'), true);
      return true;
    });

    await fs.rm(path.join(root, 'published'), { recursive: true, force: true });
    await fs.symlink(outside, path.join(root, 'published'), 'dir');
    await assert.rejects(() => previewPublication(root, 'proof'), (error: PublisherError) => error.code === 'UNSAFE_PUBLICATION_TARGET_ROOT');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
});

test('runtime and published schemas expose synchronized v1 states', async () => {
  const repository = path.basename(process.cwd()) === 'core' ? path.resolve(process.cwd(), '..', '..') : process.cwd();
  const plan = JSON.parse(await fs.readFile(path.join(repository, 'schemas', 'publisher-plan.schema.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(repository, 'schemas', 'publication-manifest.schema.json'), 'utf8'));
  const status = JSON.parse(await fs.readFile(path.join(repository, 'schemas', 'publication-status.schema.json'), 'utf8'));
  assert.equal(plan.properties.schemaVersion.const, 1);
  assert.equal(manifest.properties.schemaVersion.const, 1);
  assert.deepEqual(status.properties.state.enum, ['fresh', 'stale', 'drifted', 'missing', 'unpublished', 'unknown']);
  assert.equal(PublicationManifestSchema.safeParse({}).success, false);
});
