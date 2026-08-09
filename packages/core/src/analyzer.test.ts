import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeProject } from './analyzer.js';
import { ProjectProfileSchema } from './types.js';

const fixtures = path.resolve(process.cwd(), '../../fixtures');
const repository = path.resolve(process.cwd(), '../..');

test('detects CLI fixture', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'cli'));
  assert.deepEqual(profile.surfaces.map((surface) => surface.type), ['terminal']);
  assert.equal(profile.surfaces[0]?.command, 'fixture-cli');
  assert.deepEqual(profile.packageManagers, []);
  assert.equal(profile.workspace, null);
});

test('detects web fixture', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'web'));
  assert.deepEqual(profile.surfaces.map((surface) => surface.type), ['web']);
  assert.ok(profile.frameworks.some((f) => f.name === 'Next.js'));
});

test('detects library fixture', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'library'));
  assert.deepEqual(profile.surfaces.map((surface) => surface.type), ['library']);
});

test('profiles DemoWeave as its factual pnpm workspace surfaces', async () => {
  const profile = await analyzeProject(repository);

  assert.deepEqual(profile.packageManagers, ['pnpm']);
  assert.deepEqual(profile.workspace, {
    manifest: 'pnpm-workspace.yaml',
    patterns: ['packages/*'],
  });
  assert.deepEqual(
    profile.packages.map(({ name, root, workspace }) => ({ name, root, workspace })),
    [
      { name: 'demoweave-workspace', root: '.', workspace: false },
      { name: '@demoweave/cli', root: 'packages/cli', workspace: true },
      { name: '@demoweave/core', root: 'packages/core', workspace: true },
      { name: '@demoweave/drivers', root: 'packages/drivers', workspace: true },
      { name: '@demoweave/renderer', root: 'packages/renderer', workspace: true },
    ],
  );
  assert.deepEqual(profile.frameworks, []);
  assert.deepEqual(
    profile.surfaces.map(({ id, type, root, packageName }) => ({ id, type, root, packageName })),
    [
      {
        id: 'library-demoweave-core',
        type: 'library',
        root: 'packages/core',
        packageName: '@demoweave/core',
      },
      {
        id: 'library-demoweave-drivers',
        type: 'library',
        root: 'packages/drivers',
        packageName: '@demoweave/drivers',
      },
      {
        id: 'library-demoweave-renderer',
        type: 'library',
        root: 'packages/renderer',
        packageName: '@demoweave/renderer',
      },
      {
        id: 'terminal-demoweave-cli',
        type: 'terminal',
        root: 'packages/cli',
        packageName: '@demoweave/cli',
      },
    ],
  );
  assert.deepEqual(profile.commands.install, ['pnpm install']);
  assert.deepEqual(profile.commands.build, ['pnpm build']);
  assert.deepEqual(profile.commands.test, ['pnpm test']);
  assert.deepEqual(profile.commands.run, ['demoweave']);
  assert.deepEqual(profile.existingDocs, ['README.md', 'ROADMAP.md']);
  assert.ok(profile.languages.some((language) => language.name === 'TypeScript'));
  assert.ok(!profile.surfaces.some((surface) => ['web', 'desktop', 'mobile'].includes(surface.type)));
});

test('keeps profile paths and surface IDs deterministic', async () => {
  const first = await analyzeProject(repository);
  const second = await analyzeProject(repository);

  assert.deepEqual(first.workspace, second.workspace);
  assert.deepEqual(first.packages, second.packages);
  assert.deepEqual(first.frameworks, second.frameworks);
  assert.deepEqual(first.surfaces, second.surfaces);
  assert.deepEqual(first.commands, second.commands);
  assert.deepEqual(first.existingDocs, second.existingDocs);
});

test('rejects facts outside the frozen ProjectProfile v1 schema', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'cli'));
  const result = ProjectProfileSchema.safeParse({ ...profile, inventedConclusion: true });
  assert.equal(result.success, false);
});

test('does not use a non-JavaScript package manager for package scripts', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-analyzer-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'mixed-project',
    scripts: { build: 'tsc' },
  }));
  await fs.writeFile(path.join(root, 'uv.lock'), '');

  const profile = await analyzeProject(root);
  assert.deepEqual(profile.packageManagers, ['uv']);
  assert.deepEqual(profile.commands.install, ['uv sync']);
  assert.deepEqual(profile.commands.build, []);
});
