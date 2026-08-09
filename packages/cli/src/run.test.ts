import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repository = path.resolve(process.cwd(), '../..');
const cli = path.join(process.cwd(), 'dist', 'index.js');

test('demoweave run reports execution details and returns non-zero for a failed Flow', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-run-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'flows'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.copyFile(path.join(repository, 'fixtures', 'cli', 'src', 'index.js'), path.join(root, 'fixture-cli.js'));
  await fs.writeFile(path.join(root, '.demoweave', 'project.json'), `${JSON.stringify({
    schemaVersion: 1,
    name: 'cli-run-fixture',
    root: '.',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    packageManagers: [],
    workspaces: [],
    components: [],
    languages: [],
    frameworks: [],
    surfaces: [{ id: 'terminal-fixture', type: 'terminal', root: '.', command: 'fixture-cli' }],
    commands: { install: [], build: [], test: [], run: [] },
    existingDocs: [],
  }, null, 2)}\n`);
  const flowPath = path.join(root, '.demoweave', 'flows', 'cli-run.json');
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  const writeFlow = async (exitCode: number) => {
    await fs.writeFile(flowPath, `${JSON.stringify({
      schemaVersion: 1,
      id: 'cli-run',
      surfaceId: 'terminal-fixture',
      steps: [{
        id: 'run-fixture',
        type: 'run',
        command: process.execPath,
        args: ['fixture-cli.js', '--exit', String(exitCode)],
      }],
    }, null, 2)}\n`);
    await fs.writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: 1,
      projectProfileVersion: 1,
      flows: [{ id: 'cli-run', path: '.demoweave/flows/cli-run.json', surfaceId: 'terminal-fixture' }],
      evidence: [],
    }, null, 2)}\n`);
  };

  await writeFlow(0);
  const passed = spawnSync(process.execPath, [cli, 'run', 'cli-run', '--project', root], { encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /Flow: cli-run/);
  assert.match(passed.stdout, /Surface: terminal-fixture \(terminal\)/);
  assert.match(passed.stdout, /Driver: terminal/);
  assert.match(passed.stdout, /\[PASS\] run-fixture \(exit 0\)/);
  assert.match(passed.stdout, /Final: PASSED/);

  await writeFlow(9);
  const failed = spawnSync(process.execPath, [cli, 'run', flowPath, '--project', root], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /\[FAIL\] run-fixture \(exit 9\)/);
  assert.match(failed.stdout, /Final: FAILED/);
  assert.match(failed.stderr, /NONZERO_EXIT/);
});
