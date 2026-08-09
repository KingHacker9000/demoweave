import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeProject } from './analyzer.js';
import { ComponentSchema, ProjectProfileSchema, SurfaceSchema } from './types.js';

const fixtures = path.resolve(process.cwd(), '../../fixtures');
const repository = path.resolve(process.cwd(), '../..');

test('detects Node CLI fixture from its declared bin', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'cli'));
  assert.deepEqual(profile.surfaces.map((surface) => surface.type), ['terminal']);
  assert.equal(profile.surfaces[0]?.command, 'fixture-cli');
  assert.deepEqual(profile.packageManagers, []);
  assert.deepEqual(profile.workspaces, []);
  assert.deepEqual(profile.components, [{
    id: 'node:package.json',
    ecosystem: 'node',
    manifest: { kind: 'package.json', path: 'package.json' },
    name: 'fixture-cli',
    root: '.',
    private: false,
    scripts: { start: 'node src/index.js' },
    entrypoints: [{ kind: 'terminal', name: 'fixture-cli', target: './src/index.js' }],
  }]);
});

test('detects Node web fixture', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'web'));
  assert.deepEqual(profile.surfaces.map((surface) => surface.type), ['web']);
  assert.ok(profile.frameworks.some((framework) => framework.name === 'Next.js'));
});

test('detects Node library fixture', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'library'));
  assert.deepEqual(profile.surfaces.map((surface) => surface.type), ['library']);
  assert.equal(profile.components[0]?.ecosystem, 'node');
  assert.equal(profile.components[0]?.manifest.kind, 'package.json');
});

test('detects Python project metadata, library surface, and declared CLI entrypoint', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'python-library'));
  const component = profile.components[0];

  assert.equal(profile.name, 'fixture-python-library');
  assert.deepEqual(profile.packageManagers, ['uv']);
  assert.deepEqual(component, {
    id: 'python:pyproject.toml',
    ecosystem: 'python',
    manifest: { kind: 'pyproject.toml', path: 'pyproject.toml' },
    name: 'fixture-python-library',
    root: '.',
    entrypoints: [
      { kind: 'library' },
      { kind: 'terminal', name: 'fixture-python', target: 'fixture_python.cli:main' },
    ],
  });
  assert.ok(!Object.hasOwn(component!, 'private'));
  assert.ok(!Object.hasOwn(component!, 'scripts'));
  assert.deepEqual(profile.surfaces.map(({ type, command }) => ({ type, command })), [
    { type: 'library', command: undefined },
    { type: 'terminal', command: 'fixture-python' },
  ]);
  assert.deepEqual(profile.commands.install, []);
  assert.deepEqual(profile.commands.run, ['fixture-python']);
});

test('detects Cargo default library and binary targets from factual structure', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'rust-cli'));
  const component = profile.components[0];

  assert.equal(profile.name, 'fixture-rust-cli');
  assert.deepEqual(profile.packageManagers, ['cargo']);
  assert.equal(component?.ecosystem, 'rust');
  assert.deepEqual(component?.manifest, { kind: 'Cargo.toml', path: 'Cargo.toml' });
  assert.deepEqual(component?.entrypoints, [
    { kind: 'library', target: 'src/lib.rs' },
    { kind: 'terminal', name: 'fixture-rust-cli', target: 'src/main.rs' },
  ]);
  assert.deepEqual(profile.surfaces.map(({ type, command }) => ({ type, command })), [
    { type: 'library', command: undefined },
    { type: 'terminal', command: 'fixture-rust-cli' },
  ]);
  assert.deepEqual(profile.commands.install, []);
});

test('detects Go module identity, library package, and cmd entrypoint', async () => {
  const profile = await analyzeProject(path.join(fixtures, 'go-library'));
  const component = profile.components[0];

  assert.equal(profile.name, 'example.com/demoweave/fixture-go');
  assert.deepEqual(profile.packageManagers, ['go']);
  assert.equal(component?.ecosystem, 'go');
  assert.deepEqual(component?.manifest, { kind: 'go.mod', path: 'go.mod' });
  assert.deepEqual(component?.entrypoints, [
    { kind: 'library', target: '.' },
    { kind: 'terminal', name: 'fixture-go', target: 'cmd/fixture-go' },
  ]);
  assert.deepEqual(profile.surfaces.map(({ type, command }) => ({ type, command })), [
    { type: 'library', command: undefined },
    { type: 'terminal', command: 'fixture-go' },
  ]);
});

test('profiles DemoWeave workspace members while retaining nested manifest facts without surface leakage', async () => {
  const profile = await analyzeProject(repository);

  assert.deepEqual(profile.packageManagers, ['pnpm']);
  assert.deepEqual(profile.workspaces, [{
    id: 'node:workspace:pnpm-workspace.yaml',
    ecosystem: 'node',
    manifest: { kind: 'pnpm-workspace.yaml', path: 'pnpm-workspace.yaml' },
    root: '.',
    patterns: ['packages/*'],
  }]);
  assert.deepEqual(
    profile.components
      .filter((component) => component.root === '.' || component.workspaceId)
      .map(({ name, root, workspaceId }) => ({ name, root, workspaceId })),
    [
      { name: 'demoweave-workspace', root: '.', workspaceId: undefined },
      { name: '@demoweave/cli', root: 'packages/cli', workspaceId: 'node:workspace:pnpm-workspace.yaml' },
      { name: '@demoweave/core', root: 'packages/core', workspaceId: 'node:workspace:pnpm-workspace.yaml' },
      { name: '@demoweave/drivers', root: 'packages/drivers', workspaceId: 'node:workspace:pnpm-workspace.yaml' },
      { name: '@demoweave/renderer', root: 'packages/renderer', workspaceId: 'node:workspace:pnpm-workspace.yaml' },
    ],
  );
  assert.deepEqual(
    [...new Set(profile.components.filter((component) => component.root.startsWith('fixtures/')).map((component) => component.ecosystem))].sort(),
    ['go', 'node', 'python', 'rust'],
  );
  assert.deepEqual(profile.frameworks, []);
  assert.deepEqual(
    profile.surfaces.map(({ id, type, root, componentId }) => ({ id, type, root, componentId })),
    [
      {
        id: 'library-demoweave-core',
        type: 'library',
        root: 'packages/core',
        componentId: 'node:packages/core/package.json',
      },
      {
        id: 'library-demoweave-drivers',
        type: 'library',
        root: 'packages/drivers',
        componentId: 'node:packages/drivers/package.json',
      },
      {
        id: 'library-demoweave-renderer',
        type: 'library',
        root: 'packages/renderer',
        componentId: 'node:packages/renderer/package.json',
      },
      {
        id: 'terminal-demoweave-cli',
        type: 'terminal',
        root: 'packages/cli',
        componentId: 'node:packages/cli/package.json',
      },
    ],
  );
  assert.ok(!profile.surfaces.some((surface) => surface.root.startsWith('fixtures/')));
  assert.ok(!profile.surfaces.some((surface) => ['web', 'desktop', 'mobile'].includes(surface.type)));
  assert.deepEqual(profile.commands.install, ['pnpm install']);
  assert.deepEqual(profile.commands.build, ['pnpm build']);
  assert.deepEqual(profile.commands.test, ['pnpm test']);
  assert.deepEqual(profile.commands.run, ['demoweave']);
  assert.deepEqual(profile.existingDocs, ['README.md', 'ROADMAP.md', 'docs/M5_DOGFOOD.md', 'docs/M7_DESIGN.md']);
});

test('keeps component, workspace, path, and surface identifiers deterministic', async () => {
  const first = await analyzeProject(repository);
  const second = await analyzeProject(repository);

  assert.deepEqual(first.workspaces, second.workspaces);
  assert.deepEqual(first.components, second.components);
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

test('keeps runtime and published ProjectProfile v1 schemas synchronized', async () => {
  const published = JSON.parse(await fs.readFile(path.join(repository, 'schemas/project.schema.json'), 'utf8')) as {
    required: string[];
    $defs: {
      component: {
        oneOf: Array<{
          properties: Record<string, {
            const?: string;
            properties?: Record<string, { const?: string }>;
          }>;
          required: string[];
        }>;
      };
    };
  };
  assert.deepEqual([...published.required].sort(), [...ProjectProfileSchema.keyof().options].sort());
  assert.deepEqual(
    Object.fromEntries(published.$defs.component.oneOf.map((branch) => [
      branch.properties.ecosystem?.const,
      {
        manifest: branch.properties.manifest?.properties?.kind?.const,
        private: branch.required.includes('private'),
        scripts: Object.hasOwn(branch.properties, 'scripts'),
      },
    ])),
    {
      node: {
        manifest: 'package.json',
        private: true,
        scripts: true,
      },
      python: {
        manifest: 'pyproject.toml',
        private: false,
        scripts: false,
      },
      rust: {
        manifest: 'Cargo.toml',
        private: false,
        scripts: false,
      },
      go: {
        manifest: 'go.mod',
        private: false,
        scripts: false,
      },
    },
  );
});

test('rejects Node-only component facts on other ecosystems', () => {
  const result = ComponentSchema.safeParse({
    id: 'python:pyproject.toml',
    ecosystem: 'python',
    manifest: { kind: 'pyproject.toml', path: 'pyproject.toml' },
    name: 'python-library',
    root: '.',
    private: false,
    entrypoints: [{ kind: 'library' }],
  });
  assert.equal(result.success, false);
});

test('rejects inferred confidence values on factual surfaces', () => {
  const result = SurfaceSchema.safeParse({
    id: 'terminal-tool',
    type: 'terminal',
    root: '.',
    command: 'tool',
    confidence: 1,
  });
  assert.equal(result.success, false);
});

test('activates members of a Cargo workspace declared at the repository root', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cargo-workspace-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'crates', 'tool', 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'Cargo.toml'), [
    '[workspace]',
    'members = ["crates/*"]',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'crates', 'tool', 'Cargo.toml'), [
    '[package]',
    'name = "workspace-tool"',
    'version = "1.0.0"',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'crates', 'tool', 'src', 'main.rs'), 'fn main() {}\n');

  const profile = await analyzeProject(root);
  assert.deepEqual(profile.workspaces, [{
    id: 'rust:workspace:Cargo.toml',
    ecosystem: 'rust',
    manifest: { kind: 'Cargo.toml', path: 'Cargo.toml' },
    root: '.',
    patterns: ['crates/*'],
  }]);
  assert.equal(profile.components.find((component) => component.name === 'workspace-tool')?.workspaceId, 'rust:workspace:Cargo.toml');
  assert.deepEqual(profile.surfaces.map(({ type, root, command }) => ({ type, root, command })), [
    { type: 'terminal', root: 'crates/tool', command: 'workspace-tool' },
  ]);
});

test('detects Poetry only from explicit manifest evidence and does not invent install commands', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-poetry-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'pyproject.toml'), [
    '[tool.poetry]',
    'name = "poetry-library"',
    'version = "1.0.0"',
    '',
  ].join('\n'));

  const profile = await analyzeProject(root);
  assert.deepEqual(profile.packageManagers, ['poetry']);
  assert.deepEqual(profile.commands.install, []);
  assert.deepEqual(profile.surfaces.map((surface) => surface.type), ['library']);
});

test('does not use a non-JavaScript package manager for package.json scripts', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-analyzer-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'mixed-project',
    scripts: { build: 'tsc' },
  }));
  await fs.writeFile(path.join(root, 'uv.lock'), '');

  const profile = await analyzeProject(root);
  assert.deepEqual(profile.packageManagers, ['uv']);
  assert.deepEqual(profile.commands.install, []);
  assert.deepEqual(profile.commands.build, []);
});
