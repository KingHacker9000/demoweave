import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  EvidenceFormatSchema,
  EvidenceKindSchema,
  EvidenceSchema,
  EvidenceStatusSchema,
  FlowSchema,
  type Flow,
} from './index.js';
import { ManifestSchema, normalizeManifest, type Manifest } from './manifest.js';
import { validateMetadataBindings } from './validation.js';
import { ProjectProfileSchema, type ProjectProfile } from './types.js';

const repository = path.resolve(process.cwd(), '../..');

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(repository, relativePath), 'utf8'));
}

const project: ProjectProfile = ProjectProfileSchema.parse({
  schemaVersion: 1,
  name: 'contract-fixture',
  root: '.',
  analyzedAt: '2026-01-01T00:00:00.000Z',
  packageManagers: [],
  workspaces: [],
  components: [],
  languages: [],
  frameworks: [],
  surfaces: [
    { id: 'terminal-demoweave-cli', type: 'terminal', root: '.' },
    { id: 'web-fixture-web', type: 'web', root: '.' },
  ],
  commands: { install: [], build: [], test: [], run: [] },
  existingDocs: [],
});

test('terminal and web examples validate against the same Flow v1 contract', async () => {
  const terminal = FlowSchema.parse(await readJson('examples/flows/terminal.inspect.json'));
  const web = FlowSchema.parse(await readJson('examples/flows/web.create-project.json'));

  assert.equal(terminal.schemaVersion, 1);
  assert.equal(terminal.surfaceId, 'terminal-demoweave-cli');
  assert.ok(terminal.steps.some((step) => step.type === 'run'));

  assert.equal(web.schemaVersion, 1);
  assert.equal(web.surfaceId, 'web-fixture-web');
  assert.ok(web.steps.some((step) => step.type === 'activate'));
  assert.ok(web.steps.some((step) => step.type === 'capture'));
});

test('Flow v1 rejects duplicate step identifiers', async () => {
  const flow = FlowSchema.parse(await readJson('examples/flows/terminal.inspect.json'));
  const duplicate = {
    ...flow,
    steps: [flow.steps[0], { ...flow.steps[1], id: flow.steps[0]!.id }],
  };
  assert.equal(FlowSchema.safeParse(duplicate).success, false);
});

test('available and stale Evidence require an artifact path', () => {
  const base = {
    schemaVersion: 1,
    id: 'demo',
    kind: 'terminal',
    provenance: { sources: [] },
  } as const;

  assert.equal(EvidenceSchema.safeParse({ ...base, status: 'planned' }).success, true);
  assert.equal(EvidenceSchema.safeParse({ ...base, status: 'available' }).success, false);
  assert.equal(EvidenceSchema.safeParse({ ...base, status: 'stale' }).success, false);
  assert.equal(EvidenceSchema.safeParse({ ...base, status: 'available', path: 'docs-media/demo.ansi' }).success, true);
});

test('Evidence step provenance requires a Flow', () => {
  const result = EvidenceSchema.safeParse({
    schemaVersion: 1,
    id: 'demo',
    kind: 'screenshot',
    status: 'planned',
    provenance: { stepId: 'capture', sources: [] },
  });
  assert.equal(result.success, false);
});

test('Manifest v1 rejects duplicate Flow and Evidence ids', () => {
  const evidence = {
    schemaVersion: 1,
    id: 'same',
    kind: 'terminal',
    status: 'planned',
    provenance: { sources: [] },
  } as const;
  const duplicateFlows = {
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [
      { id: 'flow', path: '.demoweave/flows/a.json', surfaceId: 'terminal-demoweave-cli' },
      { id: 'flow', path: '.demoweave/flows/b.json', surfaceId: 'terminal-demoweave-cli' },
    ],
    evidence: [],
  };
  const duplicateEvidence = {
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [evidence, evidence],
  };

  assert.equal(ManifestSchema.safeParse(duplicateFlows).success, false);
  assert.equal(ManifestSchema.safeParse(duplicateEvidence).success, false);
});

test('normalizeManifest creates deterministic ordering without mutating input', () => {
  const input: Manifest = ManifestSchema.parse({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [
      { id: 'z-flow', path: 'z.json', surfaceId: 'terminal-demoweave-cli' },
      { id: 'a-flow', path: 'a.json', surfaceId: 'terminal-demoweave-cli' },
    ],
    evidence: [
      {
        schemaVersion: 1,
        id: 'z-evidence',
        kind: 'terminal',
        status: 'planned',
        provenance: {
          sources: [
            { path: 'z.ts', role: 'implementation' },
            { path: 'a.ts', role: 'implementation' },
          ],
        },
        derivedFrom: ['b', 'a'],
      },
      {
        schemaVersion: 1,
        id: 'a-evidence',
        kind: 'screenshot',
        status: 'planned',
        provenance: { sources: [] },
      },
    ],
  });
  const before = JSON.stringify(input);
  const normalized = normalizeManifest(input);

  assert.deepEqual(normalized.flows.map((flow) => flow.id), ['a-flow', 'z-flow']);
  assert.deepEqual(normalized.evidence.map((item) => item.id), ['a-evidence', 'z-evidence']);
  assert.deepEqual(normalized.evidence[1]?.provenance.sources.map((source) => source.path), ['a.ts', 'z.ts']);
  assert.deepEqual(normalized.evidence[1]?.derivedFrom, ['a', 'b']);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(normalizeManifest(normalized)), JSON.stringify(normalized));
});

test('metadata binding validation accepts a coherent terminal Flow and manifest', async () => {
  const flow = FlowSchema.parse(await readJson('examples/flows/terminal.inspect.json'));
  const manifest = ManifestSchema.parse({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{
      id: flow.id,
      path: '.demoweave/flows/inspect-project.json',
      surfaceId: flow.surfaceId,
    }],
    evidence: [{
      schemaVersion: 1,
      id: 'inspect-project-terminal',
      kind: 'terminal',
      status: 'planned',
      provenance: {
        flowId: flow.id,
        stepId: 'capture-terminal',
        surfaceId: flow.surfaceId,
        gitCommit: 'abc123',
        sources: [{ path: 'packages/cli/src/index.ts', role: 'implementation' }],
      },
    }],
  });

  assert.deepEqual(validateMetadataBindings(project, [{
    path: '.demoweave/flows/inspect-project.json',
    flow,
  }], manifest), []);
});

test('metadata binding validation reports unknown surfaces and missing Evidence', async () => {
  const source = FlowSchema.parse(await readJson('examples/flows/terminal.inspect.json'));
  const flow: Flow = { ...source, surfaceId: 'missing-surface' };
  const manifest = ManifestSchema.parse({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: flow.id, path: '.demoweave/flows/inspect-project.json', surfaceId: flow.surfaceId }],
    evidence: [],
  });
  const issues = validateMetadataBindings(project, [{
    path: '.demoweave/flows/inspect-project.json',
    flow,
  }], manifest);

  assert.ok(issues.some((issue) => issue.message.includes('unknown surface')));
  assert.ok(issues.some((issue) => issue.message.includes('absent from the manifest')));
});

test('published M2 schemas expose the same primary enums as runtime contracts', async () => {
  const flowSchema = await readJson('schemas/flow.schema.json') as any;
  const evidenceSchema = await readJson('schemas/evidence.schema.json') as any;
  const manifestSchema = await readJson('schemas/manifest.schema.json') as any;

  const captureBranch = flowSchema.$defs.step.oneOf.find((branch: any) => branch.properties.type?.const === 'capture');
  assert.deepEqual(captureBranch.properties.kind.enum, EvidenceKindSchema.options);
  assert.deepEqual(evidenceSchema.properties.kind.enum, EvidenceKindSchema.options);
  assert.deepEqual(evidenceSchema.properties.status.enum, EvidenceStatusSchema.options);
  assert.deepEqual(evidenceSchema.properties.format.enum, EvidenceFormatSchema.options);
  assert.equal(flowSchema.properties.schemaVersion.const, 1);
  assert.equal(evidenceSchema.properties.schemaVersion.const, 1);
  assert.equal(manifestSchema.properties.schemaVersion.const, 1);
  assert.equal(manifestSchema.properties.projectProfileVersion.const, 1);
});
