import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repository = path.resolve(new URL('..', import.meta.url).pathname);
const cli = path.join(repository, 'packages', 'cli', 'dist', 'index.js');

const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>M7 fixture</title></head>
<body>
  <main>
    <h1>DemoWeave M7</h1>
    <button id="open">New Project</button>
    <form id="form" hidden>
      <label>Project name <input data-testid="project-name" /></label>
      <button type="submit" aria-label="Create project">Create</button>
    </form>
    <p data-automation-id="result" hidden></p>
  </main>
  <script>
    const form = document.querySelector('#form');
    const result = document.querySelector('[data-automation-id="result"]');
    document.querySelector('#open').addEventListener('click', () => { form.hidden = false; });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      result.textContent = 'Created: ' + document.querySelector('[data-testid="project-name"]').value;
      result.hidden = false;
    });
  </script>
</body>
</html>`;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: repository,
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

const server = http.createServer((request, response) => {
  if (request.url !== '/') {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not resolve M7 fixture server address');
const baseUrl = `http://127.0.0.1:${address.port}`;
const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-m7-smoke-'));

try {
  await fs.mkdir(path.join(projectRoot, '.demoweave', 'flows'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.demoweave', 'evidence'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'fixture.html'), html, 'utf8');

  const project = {
    schemaVersion: 1,
    name: 'm7-web-smoke',
    root: '.',
    analyzedAt: '2026-08-10T00:00:00.000Z',
    packageManagers: [],
    workspaces: [],
    components: [],
    languages: [],
    frameworks: [],
    surfaces: [{ id: 'web-smoke', type: 'web', root: '.', label: 'M7 fixture' }],
    commands: { install: [], build: [], test: [], run: [] },
    existingDocs: [],
  };
  const flow = {
    schemaVersion: 1,
    id: 'web-smoke',
    surfaceId: 'web-smoke',
    sources: [{ path: 'fixture.html', role: 'fixture' }],
    steps: [
      { id: 'open-home', type: 'navigate', destination: '/' },
      { id: 'open-create', type: 'activate', target: { strategy: 'text', value: 'New Project', exact: true } },
      { id: 'form-ready', type: 'wait', condition: { kind: 'visible', target: { strategy: 'label', value: 'Project name' } } },
      { id: 'enter-name', type: 'input', target: { strategy: 'testId', value: 'project-name' }, value: 'M7 Project', clear: true },
      { id: 'submit', type: 'activate', target: { strategy: 'accessibilityId', value: 'Create project' } },
      { id: 'result-ready', type: 'wait', condition: { kind: 'text', value: 'M7 Project' } },
      { id: 'result-text', type: 'assert', assertion: { kind: 'textContains', target: { strategy: 'automationId', value: 'result' }, value: 'M7 Project' } },
      { id: 'capture', type: 'capture', evidenceId: 'm7-web-result', kind: 'screenshot' },
    ],
  };
  await fs.writeFile(path.join(projectRoot, '.demoweave', 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
  await fs.writeFile(path.join(projectRoot, '.demoweave', 'flows', 'web-smoke.json'), `${JSON.stringify(flow, null, 2)}\n`);
  await fs.writeFile(path.join(projectRoot, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: 'web-smoke', path: '.demoweave/flows/web-smoke.json', surfaceId: 'web-smoke' }],
    evidence: [],
  }, null, 2)}\n`);

  const execution = await run(['run', 'web-smoke', '--project', projectRoot, '--base-url', baseUrl, '--timeout', '10000']);
  assert.equal(execution.code, 0, `${execution.stdout}\n${execution.stderr}`);
  assert.match(execution.stdout, /Driver: web/);
  assert.match(execution.stdout, /Final: PASSED/);

  const screenshot = await fs.readFile(path.join(projectRoot, '.demoweave', 'evidence', 'artifacts', 'm7-web-result.png'));
  assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, '.demoweave', 'evidence', 'manifest.json'), 'utf8'));
  const evidence = manifest.evidence.find((item) => item.id === 'm7-web-result');
  assert.equal(evidence?.kind, 'screenshot');
  assert.equal(evidence?.producer?.id, 'web');
  assert.match(evidence?.artifactHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence?.provenance?.flowHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence?.provenance?.sources?.[0]?.hash ?? '', /^sha256:[0-9a-f]{64}$/);

  const status = await run(['status', projectRoot, '--json']);
  assert.equal(status.code, 0, `${status.stdout}\n${status.stderr}`);
  const freshness = JSON.parse(status.stdout);
  assert.equal(freshness.evidence.find((item) => item.evidenceId === 'm7-web-result')?.state, 'fresh');

  const validation = await run(['validate', projectRoot]);
  assert.equal(validation.code, 0, `${validation.stdout}\n${validation.stderr}`);
  assert.match(validation.stdout, /Metadata bindings are valid/);

  console.log('M7 web smoke passed: built CLI drove Chromium, captured fingerprinted screenshot Evidence, and validated fresh metadata.');
} finally {
  await fs.rm(projectRoot, { recursive: true, force: true });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
