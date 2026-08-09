import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FreshnessReportSchema,
  ManifestSchema,
  analyzeFreshness,
  type Flow,
  type ProjectProfile,
} from '@demoweave/core';
import { runFlow } from './executor.js';

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DemoWeave web fixture</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 40px; }
    main { max-width: 720px; margin: 0 auto; }
    form { display: grid; gap: 12px; margin-top: 24px; }
    [hidden] { display: none !important; }
    .spacer { height: 900px; }
  </style>
</head>
<body>
  <main>
    <h1>DemoWeave Web Fixture</h1>
    <button id="new-project">New Project</button>
    <form id="project-form" hidden>
      <label>Project name <input name="projectName" data-testid="project-name" /></label>
      <button type="submit" aria-label="Create project">Create</button>
    </form>
    <p data-automation-id="project-result" hidden></p>
    <div class="spacer"></div>
  </main>
  <script>
    const open = document.querySelector('#new-project');
    const form = document.querySelector('#project-form');
    const result = document.querySelector('[data-automation-id="project-result"]');
    open.addEventListener('click', () => { form.hidden = false; });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = form.elements.projectName.value;
      result.textContent = 'Created: ' + name;
      result.hidden = false;
    });
  </script>
</body>
</html>`;

async function startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    if (request.url === '/not-found') {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(HTML);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not resolve fixture server address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function createProject(
  context: { after: (callback: () => void | Promise<void>) => void },
  steps: Flow['steps'],
): Promise<{ root: string; flow: Flow }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-web-driver-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const flow: Flow = {
    schemaVersion: 1,
    id: 'web-fixture-flow',
    surfaceId: 'web-fixture',
    sources: [{ path: 'fixture.html', role: 'fixture' }],
    steps,
  };
  const project: ProjectProfile = {
    schemaVersion: 1,
    name: 'web-driver-test',
    root: '.',
    analyzedAt: new Date().toISOString(),
    packageManagers: [],
    workspaces: [],
    components: [],
    languages: [],
    frameworks: [],
    surfaces: [{ id: 'web-fixture', type: 'web', root: '.', label: 'Web fixture' }],
    commands: { install: [], build: [], test: [], run: [] },
    existingDocs: [],
  };
  await fs.mkdir(path.join(root, '.demoweave', 'flows'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.writeFile(path.join(root, 'fixture.html'), HTML, 'utf8');
  await fs.writeFile(path.join(root, '.demoweave', 'project.json'), `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(root, '.demoweave', 'flows', 'web-fixture-flow.json'), `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: flow.id, path: '.demoweave/flows/web-fixture-flow.json', surfaceId: flow.surfaceId }],
    evidence: [],
  }, null, 2)}\n`, 'utf8');
  return { root, flow };
}

test('drives a semantic web Flow and captures fingerprinted screenshot Evidence', async (context) => {
  const server = await startServer();
  context.after(server.close);
  const project = await createProject(context, [
    { id: 'open-home', type: 'navigate', destination: '/' },
    { id: 'button-ready', type: 'wait', condition: { kind: 'visible', target: { strategy: 'role', value: 'button' } } },
    { id: 'open-create', type: 'activate', target: { strategy: 'text', value: 'New Project', exact: true } },
    { id: 'form-ready', type: 'wait', condition: { kind: 'visible', target: { strategy: 'label', value: 'Project name' } } },
    { id: 'enter-name', type: 'input', target: { strategy: 'testId', value: 'project-name' }, value: 'Demo Project', clear: true },
    { id: 'keyboard-step', type: 'press', key: 'Tab' },
    { id: 'submit', type: 'activate', target: { strategy: 'accessibilityId', value: 'Create project' } },
    { id: 'result-ready', type: 'wait', condition: { kind: 'text', value: 'Demo Project' } },
    { id: 'result-visible', type: 'assert', assertion: { kind: 'visible', target: { strategy: 'automationId', value: 'project-result' } } },
    { id: 'result-text', type: 'assert', assertion: { kind: 'textContains', target: { strategy: 'automationId', value: 'project-result' }, value: 'Demo Project' } },
    { id: 'scroll-page', type: 'scroll', direction: 'down', amount: 240 },
    { id: 'capture-result', type: 'capture', evidenceId: 'web-result', kind: 'screenshot' },
  ]);

  const result = await runFlow(project.flow.id, { projectRoot: project.root, baseUrl: server.baseUrl, commandTimeoutMs: 10_000 });
  assert.equal(result.status, 'passed');
  assert.equal(result.driverId, 'web');
  assert.deepEqual(result.steps.map((step) => step.status), Array(project.flow.steps.length).fill('passed'));

  const artifactPath = path.join(project.root, '.demoweave', 'evidence', 'artifacts', 'web-result.png');
  const bytes = await fs.readFile(artifactPath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(
    path.join(project.root, '.demoweave', 'evidence', 'manifest.json'),
    'utf8',
  )));
  const evidence = manifest.evidence.find((item) => item.id === 'web-result');
  assert.equal(evidence?.kind, 'screenshot');
  assert.equal(evidence?.format, 'png');
  assert.equal(evidence?.producer.id, 'web');
  assert.match(evidence?.artifactHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence?.provenance.flowHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence?.provenance.sources[0]?.hash ?? '', /^sha256:[0-9a-f]{64}$/);

  const freshness = FreshnessReportSchema.parse(await analyzeFreshness(project.root));
  assert.equal(freshness.evidence.find((item) => item.evidenceId === 'web-result')?.state, 'fresh');
});

test('fails relative navigation without a base URL instead of guessing an origin', async (context) => {
  const project = await createProject(context, [
    { id: 'open-home', type: 'navigate', destination: '/' },
    { id: 'capture-result', type: 'capture', evidenceId: 'should-not-exist', kind: 'screenshot' },
  ]);
  const result = await runFlow(project.flow.id, { projectRoot: project.root, commandTimeoutMs: 5_000 });
  assert.equal(result.status, 'failed');
  assert.equal(result.driverId, 'web');
  assert.equal(result.steps[0]?.status, 'failed');
  assert.equal(result.steps[1]?.status, 'skipped');
  assert.match(result.steps[0]?.error?.message ?? '', /requires --base-url/);
});

test('surfaces HTTP navigation errors deterministically', async (context) => {
  const server = await startServer();
  context.after(server.close);
  const project = await createProject(context, [
    { id: 'open-missing', type: 'navigate', destination: '/not-found' },
  ]);
  const result = await runFlow(project.flow.id, { projectRoot: project.root, baseUrl: server.baseUrl, commandTimeoutMs: 5_000 });
  assert.equal(result.status, 'failed');
  assert.equal(result.steps[0]?.error?.code, 'NAVIGATION_HTTP_ERROR');
});
