import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const repository = process.cwd();
const committedFixture = path.join(repository, 'fixtures', 'web');
const cli = path.join(repository, 'packages', 'cli', 'dist', 'index.js');
const npm = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const git = process.platform === 'win32' ? 'git.exe' : 'git';

function npmArgs(args) {
  return process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repository,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runChecked(command, args, options) {
  const result = await run(command, args, options);
  assert.equal(result.code, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function runCli(projectRoot, args) {
  return run(process.execPath, [cli, ...args], { cwd: projectRoot });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a fixture port');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForPage(url, expected, serverOutput, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.text();
      if (response.ok && body.includes(expected)) return;
      lastError = new Error(`HTTP ${response.status}; expected page text: ${expected}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Fixture server did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}\n${serverOutput()}`);
}

async function trackedSnapshot(projectRoot) {
  const listed = await runChecked(git, ['ls-files', '-z'], { cwd: projectRoot });
  const files = listed.stdout.split('\0').filter(Boolean).sort();
  const snapshot = {};
  for (const file of files) snapshot[file] = sha256(await fs.readFile(path.join(projectRoot, file)));
  return snapshot;
}

function startServer(projectRoot, port) {
  let stdout = '';
  let stderr = '';
  const child = spawn(npm, npmArgs(['run', 'start', '--', '--hostname', '127.0.0.1', '--port', String(port)]), {
    cwd: projectRoot,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-64_000); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-64_000); });
  child.once('error', (error) => { stderr += `\n${error.message}`; });
  return { child, output: () => `${stdout}\n${stderr}` };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  const exited = new Promise((resolve) => server.child.once('exit', resolve));
  if (process.platform === 'win32') {
    await run('taskkill', ['/pid', String(server.child.pid), '/T', '/F']);
  } else {
    try {
      process.kill(-server.child.pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-p1-web-'));
const projectRoot = path.join(temporaryRoot, 'fixture-web');
let server;

try {
  await fs.cp(committedFixture, projectRoot, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(committedFixture, source).replaceAll(path.sep, '/');
      return ![
        'node_modules',
        '.next',
        '.demoweave/project.json',
        '.demoweave/plans',
      ].some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`));
    },
  });

  await runChecked(git, ['init'], { cwd: projectRoot });
  await runChecked(git, ['config', 'user.name', 'DemoWeave CI'], { cwd: projectRoot });
  await runChecked(git, ['config', 'user.email', 'ci@demoweave.local'], { cwd: projectRoot });
  await runChecked(git, ['add', '.'], { cwd: projectRoot });
  await runChecked(git, ['commit', '-m', 'P1 fixture baseline'], { cwd: projectRoot });

  await runChecked(npm, npmArgs(['ci']), { cwd: projectRoot });
  await runChecked(npm, npmArgs(['run', 'build']), { cwd: projectRoot });
  const postBuildStatus = await runChecked(git, ['status', '--porcelain'], { cwd: projectRoot });
  assert.equal(postBuildStatus.stdout, '', `Fixture install/build changed tracked files:\n${postBuildStatus.stdout}`);

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  server = startServer(projectRoot, port);
  await waitForPage(baseUrl, 'Keep product work visible and moving.', server.output);

  const inspection = await runCli(projectRoot, ['inspect', '.']);
  assert.equal(inspection.code, 0, `${inspection.stdout}\n${inspection.stderr}`);
  const profile = JSON.parse(await fs.readFile(path.join(projectRoot, '.demoweave', 'project.json'), 'utf8'));
  assert.equal(profile.name, 'fixture-web');
  assert.deepEqual(profile.surfaces.map(({ id, type, framework }) => ({ id, type, framework })), [
    { id: 'web-fixture-web', type: 'web', framework: 'Next.js' },
  ]);

  const execution = await runCli(projectRoot, ['run', 'create-project', '--project', '.', '--base-url', baseUrl, '--timeout', '30000']);
  assert.equal(execution.code, 0, `${execution.stdout}\n${execution.stderr}\n${server.output()}`);
  assert.match(execution.stdout, /Driver: web/);
  assert.match(execution.stdout, /Final: PASSED/);

  const artifactPath = path.join(projectRoot, '.demoweave', 'evidence', 'artifacts', 'create-project-result.png');
  const artifact = await fs.readFile(artifactPath);
  assert.deepEqual([...artifact.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(artifact.readUInt32BE(16), 1280);
  assert.equal(artifact.readUInt32BE(20), 720);

  const manifestPath = path.join(projectRoot, '.demoweave', 'evidence', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const evidence = manifest.evidence.find((item) => item.id === 'create-project-result');
  assert.equal(evidence?.kind, 'screenshot');
  assert.equal(evidence?.producer?.id, 'web');
  assert.equal(evidence?.provenance?.flowId, 'create-project');
  assert.equal(evidence?.provenance?.surfaceId, 'web-fixture-web');
  assert.match(evidence?.provenance?.gitCommit ?? '', /^[0-9a-f]{40}$/);
  assert.match(evidence?.artifactHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence?.provenance?.flowHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(evidence?.provenance?.sources?.map((source) => source.path), [
    'app/globals.css',
    'app/layout.tsx',
    'app/page.tsx',
  ]);
  assert.ok(evidence.provenance.sources.every((source) => /^sha256:[0-9a-f]{64}$/.test(source.hash)));

  const readmePath = path.join(projectRoot, 'README.md');
  const readme = await fs.readFile(readmePath, 'utf8');
  assert.match(readme, /\.demoweave\/evidence\/artifacts\/create-project-result\.png/);

  const fresh = await runCli(projectRoot, ['status', '.', '--json']);
  assert.equal(fresh.code, 0, `${fresh.stdout}\n${fresh.stderr}`);
  const freshReport = JSON.parse(fresh.stdout);
  assert.equal(freshReport.evidence.find((item) => item.evidenceId === 'create-project-result')?.state, 'fresh');
  assert.equal(freshReport.summary.actions, 0);

  const sourcePath = path.join(projectRoot, 'app', 'page.tsx');
  const source = await fs.readFile(sourcePath, 'utf8');
  const changedSource = source.replace(
    'Keep product work visible and moving.',
    'Keep launch work visible and moving.',
  );
  assert.notEqual(changedSource, source);
  await fs.writeFile(sourcePath, changedSource, 'utf8');
  await stopServer(server);
  await runChecked(npm, npmArgs(['run', 'build']), { cwd: projectRoot });
  server = startServer(projectRoot, port);
  await waitForPage(baseUrl, 'Keep launch work visible and moving.', server.output);

  const stale = await runCli(projectRoot, ['status', '.', '--json']);
  assert.equal(stale.code, 0, `${stale.stdout}\n${stale.stderr}`);
  const staleReport = JSON.parse(stale.stdout);
  const staleEvidence = staleReport.evidence.find((item) => item.evidenceId === 'create-project-result');
  assert.equal(staleEvidence?.state, 'stale');
  assert.ok(staleEvidence.reasons.some((reason) => reason.code === 'source-changed' && reason.path === 'app/page.tsx'));
  assert.deepEqual(staleReport.documents, [{ path: 'README.md', evidenceIds: ['create-project-result'] }]);
  assert.deepEqual(staleReport.regeneration, [{
    kind: 'run-flow',
    flowId: 'create-project',
    evidenceIds: ['create-project-result'],
  }]);

  const missingContext = await runCli(projectRoot, ['update', '.', '--apply', '--json']);
  assert.equal(missingContext.code, 1);
  assert.match(missingContext.stderr, /requires --base-url/);

  const repaired = await runCli(projectRoot, ['update', '.', '--apply', '--base-url', baseUrl, '--json']);
  assert.equal(repaired.code, 0, `${repaired.stdout}\n${repaired.stderr}\n${server.output()}`);
  const repairedReport = JSON.parse(repaired.stdout);
  assert.deepEqual(repairedReport.actions, [{
    kind: 'run-flow',
    flowId: 'create-project',
    evidenceIds: ['create-project-result'],
  }]);
  assert.equal(repairedReport.after.evidence.find((item) => item.evidenceId === 'create-project-result')?.state, 'fresh');
  assert.equal(repairedReport.after.summary.actions, 0);
  assert.equal(await fs.readFile(readmePath, 'utf8'), readme);

  const beforeNoChange = await trackedSnapshot(projectRoot);
  const noChange = await runCli(projectRoot, ['update', '.', '--apply', '--base-url', baseUrl, '--json']);
  assert.equal(noChange.code, 0, `${noChange.stdout}\n${noChange.stderr}`);
  const noChangeReport = JSON.parse(noChange.stdout);
  assert.deepEqual(noChangeReport.actions, []);
  assert.equal(noChangeReport.after.summary.actions, 0);
  assert.deepEqual(await trackedSnapshot(projectRoot), beforeNoChange);

  const validation = await runCli(projectRoot, ['validate', '.']);
  assert.equal(validation.code, 0, `${validation.stdout}\n${validation.stderr}`);
  assert.match(validation.stdout, /Metadata bindings are valid/);

  console.log('P1 web fixture smoke passed: committed app + Flow produced real screenshot Evidence, stale source impact reached README.md, selective update used explicit runtime context, and the second update had zero actions and zero tracked-byte churn.');
} finally {
  await stopServer(server);
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
