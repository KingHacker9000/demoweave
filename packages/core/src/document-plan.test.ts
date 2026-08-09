import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  DocumentPatchError,
  DocumentPlanSchema,
  applyDocumentPlan,
  discardDocumentPlan,
  hashDocumentSource,
  inspectMarkdownFile,
  inspectMarkdownSource,
  previewDocumentPlan,
} from './index.js';

const repository = path.resolve(process.cwd(), '../..');

async function fixture(context: TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-docs-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'plans'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  return root;
}

async function writePlan(root: string, name: string, value: unknown): Promise<string> {
  const relative = `.demoweave/plans/${name}.json`;
  await fs.writeFile(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
  return relative;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof DocumentPatchError ? error.code : undefined;
}

test('inspects ATX sections deterministically, ignores fenced pseudo-headings, and disambiguates duplicates', () => {
  const source = [
    'Preamble',
    '# Overview',
    'intro',
    '```md',
    '# Not a real heading',
    '```',
    '## Usage',
    'first',
    '### Nested',
    'nested',
    '## Usage',
    'second',
    '',
  ].join('\n');
  const first = inspectMarkdownSource('README.md', source);
  const second = inspectMarkdownSource('README.md', source);
  assert.deepEqual(second, first);
  assert.equal(first.sections.length, 5);
  assert.equal(first.sections[0]?.id, 'preamble');
  assert.deepEqual(first.sections.slice(1).map((section) => section.heading), ['Overview', 'Usage', 'Nested', 'Usage']);
  const usage = first.sections.filter((section) => section.heading === 'Usage');
  assert.equal(usage.length, 2);
  assert.notEqual(usage[0]?.id, usage[1]?.id);
  assert.deepEqual(usage[0]?.headingPath, ['Overview', 'Usage']);
  assert.deepEqual(usage[1]?.headingPath, ['Overview', 'Usage']);
  assert.equal(usage[0]?.occurrence, 1);
  assert.equal(usage[1]?.occurrence, 2);
  assert.equal(first.sections.some((section) => section.heading === 'Not a real heading'), false);
});

test('reports CRLF/no-trailing-newline and supports headingless, Unicode-heading, and empty sections', () => {
  const crlf = inspectMarkdownSource('docs/guide.md', '# A\r\nbody\r\n# B');
  assert.equal(crlf.newline, 'crlf');
  assert.equal(crlf.trailingNewline, false);
  assert.equal(crlf.sections.length, 3);

  const plain = inspectMarkdownSource('notes.md', 'plain unicode π text');
  assert.equal(plain.newline, 'none');
  assert.equal(plain.sections.length, 1);
  assert.equal(plain.sections[0]?.id, 'preamble');
  assert.equal(plain.sections[0]?.end, 'plain unicode π text'.length);

  const unicode = inspectMarkdownSource('unicode.md', '# ಕನ್ನಡ ಶೀರ್ಷಿಕೆ\n\n## 空の節\n# Next\nbody\n');
  assert.deepEqual(unicode.sections.slice(1).map((section) => section.heading), ['ಕನ್ನಡ ಶೀರ್ಷಿಕೆ', '空の節', 'Next']);
  const empty = unicode.sections.find((section) => section.heading === '空の節')!;
  assert.equal(unicode.targetPath, 'unicode.md');
  assert.equal(unicode.sections.some((section) => section.id.includes('heading')), false);
  assert.equal(unicode.sections.find((section) => section.heading === 'Next')?.start, empty.end);
  assert.equal(unicode.sections[0]?.start, 0);
});

test('previews preserve/edit/create operations without mutating the target, then applies only the reviewed candidate', async (context) => {
  const root = await fixture(context);
  const source = 'Preface\n# Alpha\nalpha body\n# Beta\nbeta body\n# Gamma\ngamma body\n';
  const target = path.join(root, 'README.md');
  await fs.writeFile(target, source);
  const inspection = await inspectMarkdownFile(root, 'README.md');
  const alpha = inspection.sections.find((section) => section.heading === 'Alpha')!;
  const beta = inspection.sections.find((section) => section.heading === 'Beta')!;
  const gamma = inspection.sections.find((section) => section.heading === 'Gamma')!;
  const planPath = await writePlan(root, 'readme', {
    schemaVersion: 1,
    id: 'readme-refinement',
    targetPath: 'README.md',
    baseHash: inspection.baseHash,
    operations: [
      { id: 'keep-alpha', type: 'preserve', selector: { sectionId: alpha.id } },
      { id: 'edit-beta', type: 'edit', selector: { sectionId: beta.id }, markdown: 'new beta body\n' },
      { id: 'add-delta', type: 'create', anchor: { sectionId: gamma.id }, position: 'before', markdown: '# Delta\ndelta body\n' },
    ],
  });

  const preview = await previewDocumentPlan(root, planPath);
  assert.equal(await fs.readFile(target, 'utf8'), source);
  assert.match(preview.reviewToken, /^review-v1:[0-9a-f]{64}$/);
  assert.equal((await previewDocumentPlan(root, planPath)).reviewToken, preview.reviewToken);
  assert.match(preview.diff, /^--- a\/README\.md\n\+\+\+ b\/README\.md\n@@/);
  assert.equal(preview.candidate, 'Preface\n# Alpha\nalpha body\n# Beta\nnew beta body\n# Delta\ndelta body\n# Gamma\ngamma body\n');

  const result = await applyDocumentPlan(root, planPath, preview.reviewToken);
  assert.equal(result.beforeHash, inspection.baseHash);
  assert.equal(result.afterHash, hashDocumentSource(preview.candidate));
  assert.equal(await fs.readFile(target, 'utf8'), preview.candidate);
});

test('replace and reasoned remove splice exact source ranges', async (context) => {
  const root = await fixture(context);
  const source = '# One\none\n# Two\ntwo\n# Three\nthree\n';
  await fs.writeFile(path.join(root, 'docs', 'guide.md'), source);
  const inspection = await inspectMarkdownFile(root, 'docs/guide.md');
  const one = inspection.sections.find((section) => section.heading === 'One')!;
  const two = inspection.sections.find((section) => section.heading === 'Two')!;
  const three = inspection.sections.find((section) => section.heading === 'Three')!;
  const planPath = await writePlan(root, 'guide', {
    schemaVersion: 1,
    id: 'guide-update',
    targetPath: 'docs/guide.md',
    baseHash: inspection.baseHash,
    operations: [
      { id: 'keep-one', type: 'preserve', selector: { sectionId: one.id } },
      { id: 'replace-two', type: 'replace', selector: { sectionId: two.id }, markdown: '# Second\nreplacement\n' },
      { id: 'remove-three', type: 'remove', selector: { sectionId: three.id }, reason: 'obsolete section' },
    ],
  });
  const preview = await previewDocumentPlan(root, planPath);
  assert.equal(preview.candidate, '# One\none\n# Second\nreplacement\n');
});

test('rejects overlapping parent/child edits, conflicting create anchors, and preserve violations', async (context) => {
  const root = await fixture(context);
  const source = '# Parent\nbody\n## Child\nchild\n# End\nend\n';
  await fs.writeFile(path.join(root, 'README.md'), source);
  const inspection = await inspectMarkdownFile(root, 'README.md');
  const parent = inspection.sections.find((section) => section.heading === 'Parent')!;
  const child = inspection.sections.find((section) => section.heading === 'Child')!;
  const end = inspection.sections.find((section) => section.heading === 'End')!;

  const overlapping = await writePlan(root, 'overlap', {
    schemaVersion: 1,
    id: 'overlap',
    targetPath: 'README.md',
    baseHash: inspection.baseHash,
    operations: [
      { id: 'edit-parent', type: 'edit', selector: { sectionId: parent.id }, markdown: 'parent replacement\n' },
      { id: 'edit-child', type: 'edit', selector: { sectionId: child.id }, markdown: 'child replacement\n' },
    ],
  });
  await assert.rejects(() => previewDocumentPlan(root, overlapping), (error: unknown) => errorCode(error) === 'OVERLAPPING_OPERATIONS');

  const creates = await writePlan(root, 'creates', {
    schemaVersion: 1,
    id: 'creates',
    targetPath: 'README.md',
    baseHash: inspection.baseHash,
    operations: [
      { id: 'create-a', type: 'create', anchor: { sectionId: end.id }, position: 'before', markdown: '# A\n' },
      { id: 'create-b', type: 'create', anchor: { sectionId: end.id }, position: 'before', markdown: '# B\n' },
    ],
  });
  await assert.rejects(() => previewDocumentPlan(root, creates), (error: unknown) => errorCode(error) === 'OVERLAPPING_OPERATIONS' || errorCode(error) === 'CONFLICTING_ANCHOR');

  const preserve = await writePlan(root, 'preserve', {
    schemaVersion: 1,
    id: 'preserve',
    targetPath: 'README.md',
    baseHash: inspection.baseHash,
    operations: [
      { id: 'keep-child', type: 'preserve', selector: { sectionId: child.id } },
      { id: 'edit-parent', type: 'edit', selector: { sectionId: parent.id }, markdown: 'parent replacement\n' },
    ],
  });
  await assert.rejects(() => previewDocumentPlan(root, preserve), (error: unknown) => errorCode(error) === 'PRESERVE_CONFLICT' || errorCode(error) === 'OVERLAPPING_OPERATIONS');
});

test('apply rejects missing/wrong review tokens, changed plans, and stale targets', async (context) => {
  const root = await fixture(context);
  const target = path.join(root, 'README.md');
  const source = '# A\nold\n';
  await fs.writeFile(target, source);
  const inspection = await inspectMarkdownFile(root, 'README.md');
  const section = inspection.sections.find((item) => item.heading === 'A')!;
  const planPath = await writePlan(root, 'review', {
    schemaVersion: 1,
    id: 'review',
    targetPath: 'README.md',
    baseHash: inspection.baseHash,
    operations: [{ id: 'edit', type: 'edit', selector: { sectionId: section.id }, markdown: 'new\n' }],
  });
  const preview = await previewDocumentPlan(root, planPath);

  await assert.rejects(() => applyDocumentPlan(root, planPath, ''), (error: unknown) => errorCode(error) === 'REVIEW_REQUIRED');
  await assert.rejects(() => applyDocumentPlan(root, planPath, 'review-v1:bad'), (error: unknown) => errorCode(error) === 'REVIEW_MISMATCH');

  const changedPlan = JSON.parse(await fs.readFile(path.join(root, planPath), 'utf8')) as any;
  changedPlan.operations[0].markdown = 'different\n';
  await fs.writeFile(path.join(root, planPath), `${JSON.stringify(changedPlan, null, 2)}\n`);
  await assert.rejects(() => applyDocumentPlan(root, planPath, preview.reviewToken), (error: unknown) => errorCode(error) === 'REVIEW_MISMATCH');

  changedPlan.operations[0].markdown = 'new\n';
  await fs.writeFile(path.join(root, planPath), `${JSON.stringify(changedPlan, null, 2)}\n`);
  await fs.writeFile(target, '# A\nchanged externally\n');
  await assert.rejects(() => applyDocumentPlan(root, planPath, preview.reviewToken), (error: unknown) => errorCode(error) === 'STALE_BASE');
});

test('discard deletes valid or malformed plans and leaves the document byte-for-byte unchanged', async (context) => {
  const root = await fixture(context);
  const source = '# Keep\nunchanged\n';
  const target = path.join(root, 'README.md');
  await fs.writeFile(target, source);
  const inspection = await inspectMarkdownFile(root, 'README.md');
  const section = inspection.sections.find((item) => item.heading === 'Keep')!;
  const planPath = await writePlan(root, 'discard-me', {
    schemaVersion: 1,
    id: 'discard-me',
    targetPath: 'README.md',
    baseHash: inspection.baseHash,
    operations: [{ id: 'keep', type: 'preserve', selector: { sectionId: section.id } }],
  });
  await discardDocumentPlan(root, planPath);
  await assert.rejects(() => fs.access(path.join(root, planPath)));
  assert.equal(await fs.readFile(target, 'utf8'), source);

  const malformed = '.demoweave/plans/malformed.json';
  await fs.writeFile(path.join(root, malformed), '{ definitely not json');
  await discardDocumentPlan(root, malformed);
  await assert.rejects(() => fs.access(path.join(root, malformed)));
  assert.equal(await fs.readFile(target, 'utf8'), source);
});

test('rejects path traversal and symlink targets', async (context) => {
  const root = await fixture(context);
  await fs.writeFile(path.join(root, 'README.md'), '# Safe\n');
  await assert.rejects(() => inspectMarkdownFile(root, '../outside.md'), (error: unknown) => errorCode(error) === 'PATH_OUTSIDE_PROJECT');
  await assert.rejects(() => previewDocumentPlan(root, '../plan.json'), (error: unknown) => errorCode(error) === 'PATH_OUTSIDE_PROJECT');

  if (process.platform !== 'win32') {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-outside-'));
    context.after(() => fs.rm(outsideRoot, { recursive: true, force: true }));
    const outside = path.join(outsideRoot, 'outside.md');
    await fs.writeFile(outside, '# Outside\n');
    await fs.symlink(outside, path.join(root, 'docs', 'linked.md'));
    await assert.rejects(() => inspectMarkdownFile(root, 'docs/linked.md'), (error: unknown) => errorCode(error) === 'SYMLINK_REJECTED');
  }
});

test('DocumentPlan v1 runtime schema and published JSON Schema expose all five operations', async () => {
  const sample = {
    schemaVersion: 1,
    id: 'schema-test',
    targetPath: 'README.md',
    baseHash: `sha256:${'a'.repeat(64)}`,
    operations: [
      { id: 'p', type: 'preserve', selector: { sectionId: 'preamble' } },
      { id: 'e', type: 'edit', selector: { sectionId: 'section-a' }, markdown: '' },
      { id: 'r', type: 'replace', selector: { sectionId: 'section-b' }, markdown: '# B\n' },
      { id: 'c', type: 'create', anchor: { sectionId: 'section-b' }, position: 'after', markdown: '# C\n' },
      { id: 'x', type: 'remove', selector: { sectionId: 'section-c' }, reason: 'obsolete' },
    ],
  };
  assert.equal(DocumentPlanSchema.safeParse(sample).success, true);
  assert.equal(DocumentPlanSchema.safeParse({ ...sample, operations: [...sample.operations, sample.operations[0]] }).success, false);
  assert.equal(DocumentPlanSchema.safeParse({
    ...sample,
    operations: [{ id: 'x', type: 'remove', selector: { sectionId: 'section-c' }, reason: '   ' }],
  }).success, false);

  const published = JSON.parse(await fs.readFile(path.join(repository, 'schemas', 'document-plan.schema.json'), 'utf8')) as any;
  assert.equal(published.properties.schemaVersion.const, 1);
  assert.equal(published.$defs.operation.oneOf.length, 5);
  assert.deepEqual(published.$defs.operation.oneOf.map((item: any) => item.properties.type.const), ['preserve', 'edit', 'replace', 'create', 'remove']);
  assert.equal(published.$defs.operation.oneOf[4].properties.reason.pattern, '\\S');
});
