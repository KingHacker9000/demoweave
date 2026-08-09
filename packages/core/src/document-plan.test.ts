import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DocumentPlanError,
  DocumentPlanSchema,
  applyDocumentPlanFile,
  canonicalDocumentPlan,
  discardDocumentPlanFile,
  inspectMarkdown,
  inspectMarkdownFile,
  parseDocumentPlan,
  previewDocument,
  previewDocumentPlanFile,
  type DocumentOperation,
  type DocumentPlan,
} from './index.js';

function planFor(source: string, operations: DocumentOperation[], target = 'README.md'): DocumentPlan {
  return parseDocumentPlan({
    schemaVersion: 1,
    id: 'document-test',
    targetPath: target,
    baseHash: inspectMarkdown(source, target).baseHash,
    operations,
  });
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof DocumentPlanError && error.code === code;
}

async function projectFixture(context: test.TestContext, source = '# Demo\n\nOld body.\n'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-docs-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'plans'), { recursive: true });
  await fs.writeFile(path.join(root, 'README.md'), source);
  return root;
}

async function writePlan(root: string, plan: DocumentPlan, name = 'readme.json'): Promise<string> {
  const relative = `.demoweave/plans/${name}`;
  await fs.writeFile(path.join(root, ...relative.split('/')), `${JSON.stringify(plan, null, 2)}\n`);
  return relative;
}

test('inspection produces deterministic hierarchy-based ids and ignores fenced pseudo-headings', () => {
  const source = [
    'Preamble with a table:',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '# Project',
    '',
    '```md',
    '# not a heading',
    '## neither is this',
    '```',
    '',
    '## Usage',
    '',
    '## API',
    '### Usage',
    '',
    '<div>',
    '# HTML text',
    '</div>',
    '',
    '## Usage',
    '### Café 🚀',
    '',
  ].join('\n');
  const inspection = inspectMarkdown(source, 'docs/guide.md');

  assert.equal(inspection.targetPath, 'docs/guide.md');
  assert.equal(inspection.newline, 'lf');
  assert.equal(inspection.trailingNewline, true);
  assert.deepEqual(inspection.sections.map((section) => section.id), [
    'preamble',
    'section:project',
    'section:project/usage',
    'section:project/api',
    'section:project/api/usage',
    'section:project/usage~2',
    'section:project/usage~2/café',
  ]);
  assert.deepEqual(inspection.sections.at(-1)?.headingPath, ['Project', 'Usage', 'Café 🚀']);
  assert.equal(inspection.sections.some((section) => section.heading === 'not a heading'), false);
  assert.equal(source.slice(
    inspection.sections[1]!.headingRange!.start.offset,
    inspection.sections[1]!.headingRange!.end.offset,
  ), '# Project');
});

test('inspection covers ATX levels, empty sections, Unicode, no headings, CRLF, and no trailing newline', () => {
  const levels = inspectMarkdown('# A\n## B\n### C\n#### D\n##### E\n###### F', 'README.md');
  assert.deepEqual(levels.sections.slice(1).map((section) => section.level), [1, 2, 3, 4, 5, 6]);
  assert.equal(levels.trailingNewline, false);
  assert.equal(levels.sections.at(-1)?.directBodyRange.start.offset, levels.sections.at(-1)?.directBodyRange.end.offset);

  const noHeadings = inspectMarkdown('Unicode only: مرحبا 世界', 'notes.markdown');
  assert.equal(noHeadings.sections.length, 1);
  assert.equal(noHeadings.sections[0]?.id, 'preamble');
  assert.equal(noHeadings.sections[0]?.subtreeRange.end.offset, 'Unicode only: مرحبا 世界'.length);
  assert.equal(noHeadings.newline, 'none');

  const crlf = inspectMarkdown('# A\r\n\r\nBody\r\n', 'README.md');
  assert.equal(crlf.newline, 'crlf');
  assert.equal(crlf.trailingNewline, true);
});

test('edit replaces only direct body and preserves nested section bytes', () => {
  const source = '# Guide\n\n## Install\n\nOld intro.\n\n### Linux\n\napt install demo\n\n### Windows\n\nwinget install demo\n\n## Usage\n\nRun it.\n';
  const linuxAndAfter = source.slice(source.indexOf('### Linux'));
  const plan = planFor(source, [{
    id: 'edit-install-intro',
    type: 'edit',
    selector: { sectionId: 'section:guide/install' },
    markdown: '\nNew intro.\n\n',
  }]);
  const preview = previewDocument(plan, source);

  assert.match(preview.candidate, /## Install\n\nNew intro\.\n\n### Linux/);
  assert.equal(preview.candidate.slice(preview.candidate.indexOf('### Linux')), linuxAndAfter);
  assert.match(preview.unifiedDiff, /-Old intro\./);
  assert.match(preview.unifiedDiff, /\+New intro\./);
});

test('replace changes the full subtree while remove requires a reason', () => {
  const source = '# Guide\n\n## Old\n\nText\n\n### Child\n\nNested\n\n## Keep\n\nExact\n';
  const replaced = previewDocument(planFor(source, [{
    id: 'replace-old',
    type: 'replace',
    selector: { sectionId: 'section:guide/old' },
    markdown: '## New\n\nReplacement\n\n',
  }]), source).candidate;
  assert.equal(replaced, '# Guide\n\n## New\n\nReplacement\n\n## Keep\n\nExact\n');

  const removed = previewDocument(planFor(source, [{
    id: 'remove-old',
    type: 'remove',
    selector: { sectionId: 'section:guide/old' },
    reason: 'Obsolete section',
  }]), source).candidate;
  assert.equal(removed, '# Guide\n\n## Keep\n\nExact\n');
  assert.equal(DocumentPlanSchema.safeParse({
    schemaVersion: 1,
    id: 'bad-remove',
    targetPath: 'README.md',
    baseHash: inspectMarkdown(source, 'README.md').baseHash,
    operations: [{ id: 'remove', type: 'remove', selector: { sectionId: 'section:guide/old' }, reason: '   ' }],
  }).success, false);
});

test('create supports before, after, document start, and document end anchors', () => {
  const source = '# A\n\nA body.\n\n# B\n\nB body.\n';
  const cases: Array<[DocumentOperation, string]> = [
    [{ id: 'before', type: 'create', anchor: { sectionId: 'section:b' }, position: 'before', markdown: '# X\n\n' }, '# A\n\nA body.\n\n# X\n\n# B\n\nB body.\n'],
    [{ id: 'after', type: 'create', anchor: { sectionId: 'section:a' }, position: 'after', markdown: '# X\n\n' }, '# A\n\nA body.\n\n# X\n\n# B\n\nB body.\n'],
    [{ id: 'start', type: 'create', anchor: { kind: 'document-start' }, markdown: 'Intro\n\n' }, 'Intro\n\n# A\n\nA body.\n\n# B\n\nB body.\n'],
    [{ id: 'end', type: 'create', anchor: { kind: 'document-end' }, markdown: '\n# C\n' }, '# A\n\nA body.\n\n# B\n\nB body.\n\n# C\n'],
  ];
  for (const [operation, expected] of cases) {
    assert.equal(previewDocument(planFor(source, [operation]), source).candidate, expected);
  }
});

test('plans reject duplicate ids, unknown selectors, destructive overlap, preserve conflicts, and duplicate insertion points', () => {
  const source = '# Guide\n\nIntro\n\n## Child\n\nNested\n';
  assert.equal(DocumentPlanSchema.safeParse({
    schemaVersion: 1,
    id: 'duplicates',
    targetPath: 'README.md',
    baseHash: inspectMarkdown(source, 'README.md').baseHash,
    operations: [
      { id: 'same', type: 'preserve', selector: { sectionId: 'section:guide' } },
      { id: 'same', type: 'preserve', selector: { sectionId: 'section:guide/child' } },
    ],
  }).success, false);
  assert.equal(DocumentPlanSchema.safeParse({
    schemaVersion: 1,
    id: 'missing-selector',
    targetPath: 'README.md',
    baseHash: inspectMarkdown(source, 'README.md').baseHash,
    operations: [{ id: 'edit', type: 'edit', markdown: 'Changed' }],
  }).success, false);
  assert.throws(() => parseDocumentPlan({ schemaVersion: 2 }), expectCode('UNSUPPORTED_DOCUMENT_PLAN_VERSION'));

  assert.throws(() => previewDocument(planFor(source, [{ id: 'missing', type: 'edit', selector: { sectionId: 'section:nope' }, markdown: '' }]), source), expectCode('UNKNOWN_DOCUMENT_SECTION'));
  assert.throws(() => previewDocument(planFor(source, [{
    id: 'bad-anchor',
    type: 'create',
    anchor: { sectionId: 'section:nope' },
    position: 'after',
    markdown: '# New\n',
  }]), source), expectCode('UNKNOWN_DOCUMENT_SECTION'));
  assert.throws(() => previewDocument(planFor(source, [
    { id: 'replace-parent', type: 'replace', selector: { sectionId: 'section:guide' }, markdown: '# New\n' },
    { id: 'remove-child', type: 'remove', selector: { sectionId: 'section:guide/child' }, reason: 'Covered' },
  ]), source), expectCode('DOCUMENT_PLAN_CONFLICT'));
  assert.throws(() => previewDocument(planFor(source, [
    { id: 'keep-guide', type: 'preserve', selector: { sectionId: 'section:guide' } },
    { id: 'edit-child', type: 'edit', selector: { sectionId: 'section:guide/child' }, markdown: '\nChanged\n' },
  ]), source), expectCode('PRESERVED_SECTION_CONFLICT'));
  assert.throws(() => previewDocument(planFor(source, [
    { id: 'one', type: 'create', anchor: { kind: 'document-end' }, markdown: '\nOne' },
    { id: 'two', type: 'create', anchor: { kind: 'document-end' }, markdown: '\nTwo' },
  ]), source), expectCode('DOCUMENT_PLAN_CONFLICT'));

  const preserved = previewDocument(planFor(source, [{
    id: 'keep-guide',
    type: 'preserve',
    selector: { sectionId: 'section:guide' },
  }]), source);
  assert.equal(preserved.candidate, source);
  assert.equal(preserved.operations[0]?.changed, false);
  assert.equal(preserved.unifiedDiff, '(no changes)\n');
});

test('CRLF insertion is normalized while untouched bytes and trailing-newline state are preserved', () => {
  const source = '# A\r\n\r\nOld\r\n\r\n# B\r\n\r\n| A | B |\r\n| - | - |\r\n| 1 | 2 |';
  const untouched = source.slice(source.indexOf('# B'));
  const preview = previewDocument(planFor(source, [{
    id: 'edit-a',
    type: 'edit',
    selector: { sectionId: 'section:a' },
    markdown: '\nNew\n\n',
  }]), source);
  assert.equal(preview.inspection.newline, 'crlf');
  assert.equal(preview.candidate.includes('\n') && !preview.candidate.includes('\r\n'), false);
  assert.equal(preview.candidate.slice(preview.candidate.indexOf('# B')), untouched);
  assert.equal(preview.candidate.endsWith('\n'), false);
});

test('review tokens bind canonical semantic plan and candidate, not JSON property order', () => {
  const source = '# Demo\n\nOld\n';
  const first = planFor(source, [{ id: 'edit', type: 'edit', selector: { sectionId: 'section:demo' }, markdown: '\nNew\n' }]);
  const reordered = parseDocumentPlan({
    operations: [{ markdown: '\nNew\n', selector: { sectionId: 'section:demo' }, type: 'edit', id: 'edit' }],
    baseHash: first.baseHash,
    targetPath: first.targetPath,
    id: first.id,
    schemaVersion: 1,
  });
  const changed = { ...first, operations: [{ ...first.operations[0]!, markdown: '\nDifferent\n' }] };
  assert.equal(canonicalDocumentPlan(first), canonicalDocumentPlan(reordered));
  assert.equal(previewDocument(first, source).reviewToken, previewDocument(reordered, source).reviewToken);
  assert.notEqual(previewDocument(first, source).reviewToken, previewDocument(changed, source).reviewToken);
});

test('filesystem preview is non-mutating, apply requires the token, writes atomically, and refuses stale targets', async (context) => {
  const source = '# Demo\n\nOld body.\n';
  const root = await projectFixture(context, source);
  const target = path.join(root, 'README.md');
  if (process.platform !== 'win32') await fs.chmod(target, 0o640);
  const initialMode = (await fs.stat(target)).mode & 0o777;
  const plan = planFor(source, [{ id: 'edit', type: 'edit', selector: { sectionId: 'section:demo' }, markdown: '\nNew body.\n' }]);
  const planPath = await writePlan(root, plan);

  const preview = await previewDocumentPlanFile(root, planPath);
  assert.equal(await fs.readFile(target, 'utf8'), source);
  await assert.rejects(applyDocumentPlanFile(root, planPath, 'review-v1:wrong'), expectCode('REVIEW_MISMATCH'));
  const applied = await applyDocumentPlanFile(root, planPath, preview.reviewToken);
  assert.equal(applied.changed, true);
  assert.equal(await fs.readFile(target, 'utf8'), '# Demo\n\nNew body.\n');
  assert.equal((await fs.stat(target)).mode & 0o777, initialMode);
  assert.equal((await fs.readdir(root)).some((name) => name.includes('.tmp')), false);

  await fs.writeFile(target, `${source}changed`);
  await assert.rejects(previewDocumentPlanFile(root, planPath), expectCode('STALE_BASE'));
  await assert.rejects(applyDocumentPlanFile(root, planPath, preview.reviewToken), expectCode('STALE_BASE'));
});

test('discard removes only the plan and fails clearly when it is missing', async (context) => {
  const source = '# Demo\n\nOld body.\n';
  const root = await projectFixture(context, source);
  const planPath = await writePlan(root, planFor(source, [{ id: 'keep', type: 'preserve', selector: { sectionId: 'section:demo' } }]));
  const target = path.join(root, 'README.md');
  const before = await fs.readFile(target);
  assert.equal(await discardDocumentPlanFile(root, planPath), planPath);
  await assert.rejects(fs.access(path.join(root, ...planPath.split('/'))));
  assert.deepEqual(await fs.readFile(target), before);
  await assert.rejects(discardDocumentPlanFile(root, planPath), expectCode('DOCUMENT_PLAN_NOT_FOUND'));
});

test('target and plan traversal, absolute paths, Windows variants, and symlink escape are rejected', async (context) => {
  const root = await projectFixture(context);
  for (const unsafe of ['../README.md', '..\\README.md', '/tmp/README.md', 'C:\\temp\\README.md']) {
    await assert.rejects(inspectMarkdownFile(root, unsafe), expectCode('UNSAFE_DOCUMENT_TARGET'));
    await assert.rejects(previewDocumentPlanFile(root, unsafe), expectCode('UNSAFE_PLAN_PATH'));
  }

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-outside-'));
  context.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'secret.md'), '# Secret\n');
  await fs.writeFile(path.join(outside, 'plan.json'), '{}\n');
  try {
    await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'escaped.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('This Windows environment does not permit symlink creation');
      return;
    }
    throw error;
  }
  await assert.rejects(inspectMarkdownFile(root, 'escaped.md'), expectCode('UNSAFE_DOCUMENT_TARGET'));
  try {
    await fs.symlink(path.join(outside, 'plan.json'), path.join(root, '.demoweave', 'plans', 'escaped.json'));
    await assert.rejects(previewDocumentPlanFile(root, '.demoweave/plans/escaped.json'), expectCode('UNSAFE_PLAN_PATH'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
});

test('published DocumentPlan schema mirrors the runtime operation contract', async () => {
  const repository = path.resolve(process.cwd(), '../..');
  const published = JSON.parse(await fs.readFile(path.join(repository, 'schemas', 'document-plan.schema.json'), 'utf8')) as any;
  assert.equal(published.properties.schemaVersion.const, 1);
  assert.equal(published.properties.baseHash.pattern, '^sha256:[a-f0-9]{64}$');
  assert.deepEqual(published.$defs.operation.oneOf.map((branch: any) => branch.properties.type.const), [
    'preserve', 'edit', 'replace', 'create', 'create', 'remove',
  ]);
  assert.equal(published.$defs.operation.oneOf.at(-1).properties.reason.pattern, '\\S');
});
