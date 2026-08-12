import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repository = path.resolve(import.meta.dirname, '..', '..', '..');
const fixture = path.join(repository, 'fixtures', 'plugin-sdk');

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'index.js'), ...args], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('plugin CLI commands are inspectable and update --apply is selective and no-churn', async (context) => {
  const root = await fs.mkdtemp(path.join(repository, 'fixtures', '.plugin-cli-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(fixture, root, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) });
  await fs.rm(path.join(root, '.demoweave', 'project.json'), { force: true });
  await fs.rm(path.join(root, '.demoweave', 'evidence', 'artifacts'), { recursive: true, force: true });
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { evidence: unknown[] };
  manifest.evidence = [];
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const initialManifest = await fs.readFile(manifestPath);
  const listed = cli(['plugins', 'list', '--project', root, '--json']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).plugins[0].drivers, ['fixture-service-driver']);
  const doctor = cli(['plugins', 'doctor', '--project', root, '--json']);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).ok, true);
  assert.deepEqual(await fs.readFile(manifestPath), initialManifest);

  assert.equal(cli(['inspect', root]).status, 0);
  const run = cli(['run', 'service-proof', '--project', root]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Driver: plugin\/fixture-service\/fixture-service-driver/);

  await fs.appendFile(path.join(root, 'plugins', 'fixture-plugin', 'index.js'), '\n// CLI fingerprint mutation\n');
  const repaired = cli(['update', root, '--apply', '--json']);
  assert.equal(repaired.status, 0, repaired.stderr);
  const repairResult = JSON.parse(repaired.stdout);
  assert.deepEqual(repairResult.actions, [{ kind: 'run-flow', flowId: 'service-proof', evidenceIds: ['plugin-service-result'] }]);
  assert.equal(repairResult.after.summary.actions, 0);

  const stableManifest = await fs.readFile(manifestPath);
  const artifactPath = path.join(root, '.demoweave', 'evidence', 'artifacts', 'plugin-service-result.json');
  const stableArtifact = await fs.readFile(artifactPath);
  const second = cli(['update', root, '--apply', '--json']);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout).actions, []);
  assert.deepEqual(await fs.readFile(manifestPath), stableManifest);
  assert.deepEqual(await fs.readFile(artifactPath), stableArtifact);
});
