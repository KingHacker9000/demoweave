import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { analyzeProject } from './analyzer.js';

const repository = path.resolve(process.cwd(), '../..');
const fixtures = path.resolve(process.cwd(), '../../fixtures');

test('nested initialized projects own their loose research and notebook surfaces', async () => {
  const parent = await analyzeProject(repository);
  assert.equal(
    parent.surfaces.some((surface) =>
      (surface.type === 'research' || surface.type === 'notebook') &&
      surface.root.startsWith('fixtures/research')),
    false,
  );

  const nested = await analyzeProject(path.join(fixtures, 'research'));
  assert.deepEqual(
    nested.surfaces.map(({ id, type, root }) => ({ id, type, root })),
    [
      { id: 'notebook-notebooks', type: 'notebook', root: 'notebooks' },
      { id: 'research-research-workflow', type: 'research', root: 'experiments' },
    ],
  );
});
