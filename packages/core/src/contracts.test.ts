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
  TerminalCommandStatusSchema,
  TerminalTrackSchema,
  TimelinePlanSchema,
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

test('Flow v1 accepts unique expected exit codes and rejects invalid sets', () => {
  const run = {
    id: 'run',
    type: 'run',
    command: 'demo',
  } as const;
  const flow = (step: unknown) => ({
    schemaVersion: 1,
    id: 'expected-exit-codes',
    surfaceId: 'terminal-demoweave-cli',
    steps: [step],
  });

  assert.equal(FlowSchema.safeParse(flow({ ...run, expectedExitCodes: [0, 7] })).success, true);
  assert.equal(FlowSchema.safeParse(flow({ ...run, expectedExitCodes: [] })).success, false);
  assert.equal(FlowSchema.safeParse(flow({ ...run, expectedExitCodes: [7, 7] })).success, false);
  assert.equal(FlowSchema.safeParse(flow({ ...run, expectedExitCodes: [7.5] })).success, false);
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

test('plugin producer fingerprints are optional and use content-hash syntax', () => {
  const base = {
    schemaVersion: 1,
    id: 'plugin-result',
    kind: 'result',
    status: 'planned',
    producer: { kind: 'driver', id: 'plugin/example/driver' },
    provenance: { sources: [] },
  } as const;
  assert.equal(EvidenceSchema.safeParse(base).success, true);
  assert.equal(EvidenceSchema.safeParse({
    ...base,
    producer: { ...base.producer, pluginFingerprint: `sha256:${'a'.repeat(64)}` },
  }).success, true);
  assert.equal(EvidenceSchema.safeParse({
    ...base,
    producer: { ...base.producer, pluginFingerprint: 'example@1' },
  }).success, false);
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
  const runBranch = flowSchema.$defs.step.oneOf.find((branch: any) => branch.properties.type?.const === 'run');
  assert.deepEqual(captureBranch.properties.kind.enum, EvidenceKindSchema.options);
  assert.equal(runBranch.properties.expectedExitCodes.minItems, 1);
  assert.equal(runBranch.properties.expectedExitCodes.uniqueItems, true);
  assert.equal(runBranch.properties.expectedExitCodes.items.type, 'integer');
  assert.deepEqual(evidenceSchema.properties.kind.enum, EvidenceKindSchema.options);
  assert.deepEqual(evidenceSchema.properties.status.enum, EvidenceStatusSchema.options);
  assert.deepEqual(evidenceSchema.properties.format.enum, EvidenceFormatSchema.options);
  assert.equal(evidenceSchema.properties.producer.properties.pluginFingerprint.pattern, '^sha256:[0-9a-f]{64}$');
  assert.equal(flowSchema.properties.schemaVersion.const, 1);
  assert.equal(evidenceSchema.properties.schemaVersion.const, 1);
  assert.equal(manifestSchema.properties.schemaVersion.const, 1);
  assert.equal(manifestSchema.properties.projectProfileVersion.const, 1);
});

test('TerminalTrack v1 validates deterministic ordering and its published schema shape', async () => {
  const track = {
    schemaVersion: 1,
    columns: 100,
    rows: 30,
    mode: 'pipe',
    commands: [{
      stepId: 'run',
      command: 'demo',
      args: ['inspect', '.'],
      cwd: '.',
      startedAt: 0,
      durationMs: 4,
      status: 'completed',
      exitCode: 7,
    }],
    events: [
      { sequence: 0, t: 0, stepId: 'run', stream: 'input', data: 'demo inspect .\n' },
      { sequence: 1, t: 3, stepId: 'run', stream: 'stdout', data: 'done\n' },
    ],
    status: 'completed',
    exitCode: 7,
    durationMs: 4,
  };
  assert.equal(TerminalTrackSchema.safeParse(track).success, true);
  assert.equal(TerminalTrackSchema.safeParse({
    ...track,
    commands: [{ ...track.commands[0], status: 'failed' }],
    status: 'failed',
  }).success, false);
  assert.equal(TerminalTrackSchema.safeParse({
    ...track,
    events: [track.events[1], track.events[0]],
  }).success, false);

  const published = await readJson('schemas/terminal-track.schema.json') as any;
  assert.equal(published.properties.schemaVersion.const, 1);
  assert.equal(published.properties.mode.const, 'pipe');
  assert.deepEqual(published.properties.events.items.properties.stream.enum, ['input', 'stdout', 'stderr']);
  assert.deepEqual(published.properties.commands.items.properties.status.enum, TerminalCommandStatusSchema.options);
  assert.deepEqual(published.properties.status.enum, TerminalCommandStatusSchema.options);
});

const timelineFixture = {
  schemaVersion: 1,
  id: 'proof',
  canvas: { width: 1280, height: 720, fps: 12, background: '#0b0d14' },
  scenes: [{
    id: 'scene-one',
    durationMs: 5000,
    layout: { type: 'single', padding: 36 },
    panes: [{ id: 'terminal', source: { kind: 'evidence', evidenceId: 'terminal-gif' }, fit: 'contain' }],
  }],
} as const;

test('TimelinePlan v1 accepts single and split presentation layouts', () => {
  assert.equal(TimelinePlanSchema.safeParse(timelineFixture).success, true);
  assert.equal(TimelinePlanSchema.safeParse({
    ...timelineFixture,
    scenes: [{
      id: 'split-proof',
      durationMs: 6000,
      transition: 'cut',
      layout: { type: 'split', direction: 'horizontal', gap: 28, padding: 36, ratio: 0.45 },
      panes: [
        { id: 'terminal', source: { kind: 'evidence', evidenceId: 'terminal-gif' }, fit: 'contain' },
        { id: 'browser', source: { kind: 'file', path: 'proof.png' }, fit: 'cover' },
      ],
    }],
  }).success, true);
});

test('TimelinePlan v1 rejects duplicate ids and invalid geometry or versions', () => {
  assert.equal(TimelinePlanSchema.safeParse({ ...timelineFixture, schemaVersion: 2 }).success, false);
  assert.equal(TimelinePlanSchema.safeParse({ ...timelineFixture, canvas: { ...timelineFixture.canvas, fps: 0 } }).success, false);
  assert.equal(TimelinePlanSchema.safeParse({ ...timelineFixture, canvas: { ...timelineFixture.canvas, width: 1279 } }).success, false);
  assert.equal(TimelinePlanSchema.safeParse({ ...timelineFixture, scenes: [{ ...timelineFixture.scenes[0], durationMs: 0 }] }).success, false);
  assert.equal(TimelinePlanSchema.safeParse({ ...timelineFixture, scenes: [timelineFixture.scenes[0], timelineFixture.scenes[0]] }).success, false);
  assert.equal(TimelinePlanSchema.safeParse({
    ...timelineFixture,
    scenes: [{ ...timelineFixture.scenes[0], panes: [timelineFixture.scenes[0].panes[0], timelineFixture.scenes[0].panes[0]] }],
  }).success, false);
});

test('published TimelinePlan schema exposes the runtime contract shape', async () => {
  const schema = await readJson('schemas/timeline.schema.json') as any;
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.equal(schema.properties.canvas.properties.width.multipleOf, 2);
  assert.deepEqual(schema.$defs.pane.properties.fit.enum, ['contain', 'cover']);
  assert.equal(schema.$defs.layout.oneOf[0].properties.type.const, 'single');
  assert.equal(schema.$defs.layout.oneOf[1].properties.type.const, 'split');
});
