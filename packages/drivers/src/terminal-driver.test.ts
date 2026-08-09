import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  FlowSchema,
  ManifestSchema,
  ProjectProfileSchema,
  TerminalTrackSchema,
  type Flow,
  type ProjectProfile,
} from '@demoweave/core';
import { executeFlow, runFlow } from './executor.js';
import type { DriverContext, DriverStepResult, SurfaceDriver } from './index.js';

const repository = path.resolve(process.cwd(), '../..');
const fixtureSource = path.join(repository, 'fixtures', 'cli', 'src', 'index.js');

type ProjectFixture = {
  root: string;
  profile: ProjectProfile;
  flowPath: string;
};

async function createProject(context: TestContext, flow: Flow, withEvidence = false): Promise<ProjectFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-terminal-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'flows'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.copyFile(fixtureSource, path.join(root, 'fixture-cli.js'));

  const profile = ProjectProfileSchema.parse({
    schemaVersion: 1,
    name: 'terminal-fixture',
    root: '.',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    packageManagers: [],
    workspaces: [],
    components: [],
    languages: [{ name: 'JavaScript', files: 1 }],
    frameworks: [],
    surfaces: [{ id: 'terminal-fixture-cli', type: 'terminal', root: '.', command: 'fixture-cli' }],
    commands: { install: [], build: [], test: [], run: ['fixture-cli'] },
    existingDocs: [],
  });
  const flowPath = path.join(root, '.demoweave', 'flows', `${flow.id}.json`);
  await fs.writeFile(path.join(root, '.demoweave', 'project.json'), `${JSON.stringify(profile, null, 2)}\n`);
  await fs.writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: flow.id, path: `.demoweave/flows/${flow.id}.json`, surfaceId: flow.surfaceId }],
    evidence: withEvidence ? [{
      schemaVersion: 1,
      id: 'fixture-terminal',
      kind: 'terminal',
      status: 'planned',
      provenance: { sources: [{ path: 'fixture-cli.js', role: 'fixture' }] },
    }] : [],
  }, null, 2)}\n`);
  return { root, profile, flowPath };
}

function fixtureFlow(steps: Flow['steps'], id = 'fixture-flow'): Flow {
  return FlowSchema.parse({ schemaVersion: 1, id, surfaceId: 'terminal-fixture-cli', steps });
}

function normalizeTiming(track: ReturnType<typeof TerminalTrackSchema.parse>) {
  return {
    ...track,
    durationMs: 0,
    commands: track.commands.map((command) => ({ ...command, startedAt: 0, durationMs: 0 })),
    events: track.events.map((event) => ({ ...event, t: 0 })),
  };
}

test('executes the fixture CLI, asserts both streams and exit code, and captures replayable Evidence', async (context) => {
  const flow = fixtureFlow([
    {
      id: 'run-fixture',
      type: 'run',
      command: process.execPath,
      args: ['fixture-cli.js', '--stdout', 'hello world', '--stderr', 'warning', '--ansi', '--env', 'DW_TEST'],
      env: { DW_TEST: 'present' },
    },
    { id: 'assert-stdout', type: 'assert', assertion: { kind: 'outputContains', stream: 'stdout', value: 'hello world' } },
    { id: 'assert-stderr', type: 'assert', assertion: { kind: 'outputContains', stream: 'stderr', value: 'warning' } },
    { id: 'assert-combined', type: 'assert', assertion: { kind: 'outputContains', stream: 'combined', value: 'DW_TEST=present' } },
    { id: 'assert-exit', type: 'assert', assertion: { kind: 'exitCode', value: 0 } },
    { id: 'capture-terminal', type: 'capture', evidenceId: 'fixture-terminal', kind: 'terminal' },
  ]);
  const project = await createProject(context, flow, true);

  const first = await runFlow(flow.id, { projectRoot: project.root });
  assert.equal(first.status, 'passed');
  assert.deepEqual(first.steps.map((step) => step.status), Array(first.steps.length).fill('passed'));
  assert.equal(first.driverId, 'terminal');

  const artifactPath = path.join(project.root, '.demoweave', 'evidence', 'artifacts', 'fixture-terminal.terminal.json');
  const firstTrack = TerminalTrackSchema.parse(JSON.parse(await fs.readFile(artifactPath, 'utf8')));
  assert.equal(firstTrack.mode, 'pipe');
  assert.equal(firstTrack.columns, 100);
  assert.equal(firstTrack.rows, 30);
  assert.equal(firstTrack.commands[0]?.cwd, '.');
  assert.equal(firstTrack.commands[0]?.command, `<absolute>/${path.basename(process.execPath)}`);
  assert.deepEqual(firstTrack.events.map((event) => event.sequence), firstTrack.events.map((_, index) => index));
  assert.ok(firstTrack.events.every((event, index) => index === 0 || event.t >= firstTrack.events[index - 1]!.t));
  assert.ok(firstTrack.events.some((event) => event.data.includes('\u001b[31mred\u001b[0m')));
  assert.ok(!JSON.stringify(firstTrack).includes(project.root));

  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(project.root, '.demoweave', 'evidence', 'manifest.json'), 'utf8')));
  const evidence = manifest.evidence.find((item) => item.id === 'fixture-terminal');
  assert.equal(evidence?.status, 'available');
  assert.equal(evidence?.path, '.demoweave/evidence/artifacts/fixture-terminal.terminal.json');
  assert.deepEqual(evidence?.producer, { kind: 'driver', id: 'terminal', version: '0.0.1' });
  assert.deepEqual(evidence?.provenance.sources, [{ path: 'fixture-cli.js', role: 'fixture' }]);
  assert.equal(evidence?.provenance.flowId, flow.id);
  assert.equal(evidence?.provenance.stepId, 'capture-terminal');
  assert.equal(evidence?.provenance.surfaceId, flow.surfaceId);

  const second = await runFlow(flow.id, { projectRoot: project.root });
  assert.equal(second.status, 'passed');
  const secondTrack = TerminalTrackSchema.parse(JSON.parse(await fs.readFile(artifactPath, 'utf8')));
  assert.deepEqual(normalizeTiming(secondTrack), normalizeTiming(firstTrack));
});

test('returns a structured failure for a non-zero command and skips later steps', async (context) => {
  const flow = fixtureFlow([
    { id: 'run-nonzero', type: 'run', command: process.execPath, args: ['fixture-cli.js', '--exit', '7'] },
    { id: 'assert-exit', type: 'assert', assertion: { kind: 'exitCode', value: 0 } },
  ], 'nonzero-flow');
  const project = await createProject(context, flow);

  const result = await runFlow(flow.id, { projectRoot: project.root });
  assert.equal(result.status, 'failed');
  assert.equal(result.steps[0]?.status, 'failed');
  assert.equal(result.steps[0]?.exitCode, 7);
  assert.equal(result.steps[0]?.error?.code, 'NONZERO_EXIT');
  assert.equal(result.steps[1]?.status, 'skipped');
});

test('reports failed assertions without silently continuing', async (context) => {
  const flow = fixtureFlow([
    { id: 'run-fixture', type: 'run', command: process.execPath, args: ['fixture-cli.js'] },
    { id: 'assert-missing', type: 'assert', assertion: { kind: 'outputContains', stream: 'stdout', value: 'not present' } },
    { id: 'wait-after-failure', type: 'wait', condition: { kind: 'duration', ms: 0 } },
  ], 'assertion-flow');
  const project = await createProject(context, flow);

  const result = await runFlow(flow.id, { projectRoot: project.root });
  assert.equal(result.status, 'failed');
  assert.equal(result.steps[1]?.error?.code, 'ASSERTION_FAILED');
  assert.equal(result.steps[2]?.status, 'skipped');
});

test('terminates commands that exceed the configured timeout', async (context) => {
  const flow = fixtureFlow([
    { id: 'run-slow', type: 'run', command: process.execPath, args: ['fixture-cli.js', '--delay', '3000'] },
  ], 'timeout-flow');
  const project = await createProject(context, flow);
  const started = Date.now();

  const result = await runFlow(flow.id, { projectRoot: project.root, commandTimeoutMs: 100 });
  assert.equal(result.status, 'failed');
  assert.equal(result.steps[0]?.error?.code, 'COMMAND_TIMEOUT');
  assert.ok(Date.now() - started < 2500);
});

test('fails unsupported terminal Flow actions structurally', async (context) => {
  const flow = fixtureFlow([
    { id: 'navigate-nowhere', type: 'navigate', destination: 'https://example.com' },
  ], 'unsupported-flow');
  const project = await createProject(context, flow);

  const result = await runFlow(flow.id, { projectRoot: project.root });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.steps[0]?.error, {
    code: 'UNSUPPORTED_ACTION',
    message: 'Terminal driver does not support Flow action navigate',
  });
});

test('supports duration, process-exit, file-exists waits, and file assertions', async (context) => {
  const flow = fixtureFlow([
    { id: 'run-fixture', type: 'run', command: process.execPath, args: ['fixture-cli.js'] },
    { id: 'wait-exit', type: 'wait', condition: { kind: 'processExit' } },
    { id: 'wait-duration', type: 'wait', condition: { kind: 'duration', ms: 1 }, timeoutMs: 50 },
    { id: 'wait-file', type: 'wait', condition: { kind: 'fileExists', path: 'fixture-cli.js' }, timeoutMs: 50 },
    { id: 'assert-file', type: 'assert', assertion: { kind: 'fileExists', path: 'fixture-cli.js' } },
  ], 'wait-flow');
  const project = await createProject(context, flow);

  const result = await runFlow(flow.id, { projectRoot: project.root });
  assert.equal(result.status, 'passed');
});

test('always closes a prepared driver after a step failure', async (context) => {
  const flow = fixtureFlow([{ id: 'run-fixture', type: 'run', command: 'unused' }], 'cleanup-flow');
  const project = await createProject(context, flow);
  let closed = false;
  const driver: SurfaceDriver = {
    descriptor: { id: 'cleanup', apiVersion: 1, surfaceTypes: ['terminal'], stepTypes: ['run'] },
    supports: () => true,
    prepare: async () => undefined,
    execute: async (step): Promise<DriverStepResult> => ({
      stepId: step.id,
      status: 'failed',
      error: { code: 'EXPECTED', message: 'expected failure' },
    }),
    close: async (_driverContext: DriverContext) => { closed = true; },
  };

  const result = await executeFlow(project.root, project.profile, flow, project.flowPath, { drivers: [driver] });
  assert.equal(result.status, 'failed');
  assert.equal(closed, true);
});

test('executes Windows command shims with arguments containing spaces', { skip: process.platform !== 'win32' }, async (context) => {
  const flow = fixtureFlow([
    {
      id: 'run-shim',
      type: 'run',
      command: 'fixture-command.cmd',
      args: ['--stdout', 'shim value with spaces'],
    },
    {
      id: 'assert-shim',
      type: 'assert',
      assertion: { kind: 'outputContains', stream: 'stdout', value: 'shim value with spaces' },
    },
  ], 'windows-shim-flow');
  const project = await createProject(context, flow);
  await fs.writeFile(
    path.join(project.root, 'fixture-command.cmd'),
    '@echo off\r\nnode "%~dp0fixture-cli.js" %*\r\n',
  );

  const result = await runFlow(flow.id, {
    projectRoot: project.root,
    drivers: undefined,
  });
  assert.equal(result.status, 'passed', result.error?.message);
});
