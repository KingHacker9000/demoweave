import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeFreshness, analyzeProject, ManifestSchema } from '@demoweave/core';
import { loadPluginHost, runFlow } from '@demoweave/drivers';
import { renderEvidence, RendererError, type Rasterizer } from '@demoweave/renderer';
import { applyRegenerationAction } from './freshness.js';

function hash(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const fakeRasterizer: Rasterizer = {
  rasterize: () => ({ png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), width: 1, height: 1 }),
};

async function rendererProject(context: test.TestContext, pluginSource: string, evidence: unknown, artifact: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-renderer-plugin-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'evidence', 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
  await fs.writeFile(path.join(root, 'plugin.js'), pluginSource);
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), `${JSON.stringify({
    schemaVersion: 1,
    mediaDir: 'media',
    plugins: [{ module: './plugin.js', options: { secret: 'runtime-secret' } }],
  }, null, 2)}\n`);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'source.json'), artifact);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1, projectProfileVersion: 1, flows: [], evidence: [evidence],
  }, null, 2)}\n`);
  return root;
}

test('plugin rendering is host-owned, deterministic, fingerprinted, and validates before mutation', async (context) => {
  const source = {
    schemaVersion: 1, id: 'source', kind: 'result', status: 'available', label: 'Source result',
    format: 'json', path: '.demoweave/evidence/artifacts/source.json', artifactHash: hash('{"value":1}\n'),
    mimeType: 'application/json', producer: { kind: 'driver', id: 'fixture' }, provenance: { sources: [] },
  };
  const validPlugin = `export default {id:"cards",apiVersion:1,version:"2.0.0",register(r){r.registerRenderer({
    id:"card",accepts:[{kinds:["result"],formats:["json"]}],outputFormats:["svg"],create({options}){return {
      render({source,sourceBytes,format}){if(!Object.isFrozen(options)||!Object.isFrozen(source))throw new Error("mutable");return {kind:"image",format,mimeType:"image/svg+xml",label:"Result card",data:"<svg xmlns=\\"http://www.w3.org/2000/svg\\"><text>"+source.id+":"+sourceBytes.length+"</text></svg>\\n"}},close(){}}}
  })}};\n`;
  const root = await rendererProject(context, validPlugin, source, '{"value":1}\n');
  const result = await renderEvidence('source', {
    projectRoot: root, format: 'svg', rendererId: 'plugin/cards/card', pluginHost: await loadPluginHost(root),
  });
  assert.equal(result.evidenceId, 'source-card-svg');
  assert.equal(result.outputPath, path.join(root, 'media', 'source-card-svg.svg'));
  const bytes = await fs.readFile(result.outputPath);
  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8')));
  const derived = manifest.evidence.find((item) => item.id === result.evidenceId);
  assert.deepEqual(derived?.derivedFrom, ['source']);
  assert.deepEqual(derived?.producer, {
    kind: 'renderer', id: 'plugin/cards/card', version: '2.0.0', pluginFingerprint: (await loadPluginHost(root)).rendererDescriptors()[0]?.pluginFingerprint,
  });
  assert.equal(derived?.artifactHash, hash(bytes));
  assert.equal(derived?.path, 'media/source-card-svg.svg');
  assert.equal(JSON.stringify(derived).includes(root), false);
  assert.equal(JSON.stringify(derived).includes('runtime-secret'), false);

  const malformed = validPlugin.replace('data:"<svg xmlns=', 'path:"escape.svg",data:"<svg xmlns=');
  await fs.writeFile(path.join(root, 'plugin.js'), malformed);
  const beforeManifest = await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'));
  const beforeOutput = await fs.readFile(result.outputPath);
  await assert.rejects(
    renderEvidence('source', { projectRoot: root, format: 'svg', rendererId: 'plugin/cards/card', pluginHost: await loadPluginHost(root) }),
    (error: unknown) => error instanceof RendererError && error.code === 'PLUGIN_RENDERER_RESULT_INVALID',
  );
  assert.deepEqual(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json')), beforeManifest);
  assert.deepEqual(await fs.readFile(result.outputPath), beforeOutput);
});

test('overlapping plugin and terminal renderers require exact selection', async (context) => {
  const terminalTrack = `${JSON.stringify({
    schemaVersion: 1, columns: 80, rows: 24, mode: 'pipe',
    commands: [{ stepId: 'run', command: 'demo', args: [], cwd: '.', startedAt: 0, durationMs: 1, status: 'completed', exitCode: 0 }],
    events: [{ sequence: 0, t: 0, stepId: 'run', stream: 'stdout', data: 'demo\\n' }],
    status: 'completed', exitCode: 0, durationMs: 1,
  })}\n`;
  const source = {
    schemaVersion: 1, id: 'terminal', kind: 'terminal', status: 'available', format: 'json',
    path: '.demoweave/evidence/artifacts/source.json', artifactHash: hash(terminalTrack),
    mimeType: 'application/vnd.demoweave.terminal+json', provenance: { sources: [] },
  };
  const plugin = `export default {id:"overlap",apiVersion:1,register(r){r.registerRenderer({id:"png",accepts:[{kinds:["terminal"],formats:["json"]}],outputFormats:["png"],create(){return {render(){return {kind:"image",format:"png",mimeType:"image/png",data:new Uint8Array([137,80,78,71])}},close(){}}}})}};\n`;
  const root = await rendererProject(context, plugin, source, terminalTrack);
  const host = await loadPluginHost(root);
  await assert.rejects(
    renderEvidence('terminal', { projectRoot: root, format: 'png', pluginHost: host, rasterizer: fakeRasterizer }),
    (error: unknown) => error instanceof RendererError && error.code === 'RENDERER_AMBIGUOUS'
      && /plugin\/overlap\/png, terminal|terminal, plugin\/overlap\/png/.test(error.message),
  );
  const builtIn = await renderEvidence('terminal', { projectRoot: root, format: 'png', rendererId: 'terminal', pluginHost: host, rasterizer: fakeRasterizer });
  assert.equal(builtIn.evidenceId, 'terminal-png');
  const external = await renderEvidence('terminal', { projectRoot: root, format: 'png', rendererId: 'plugin/overlap/png', pluginHost: host });
  assert.equal(external.evidenceId, 'terminal-png-png');
  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8')));
  assert.equal(manifest.evidence.find((item) => item.id === 'terminal-png')?.producer?.id, 'terminal');
  assert.equal(manifest.evidence.find((item) => item.id === 'terminal-png-png')?.producer?.id, 'plugin/overlap/png');
});

test('external fixture renderer proves freshness, selective repair, no churn, and unavailable behavior', async (context) => {
  const repository = path.resolve(import.meta.dirname, '..', '..', '..');
  const fixtures = path.join(repository, 'fixtures');
  const root = await fs.mkdtemp(path.join(fixtures, '.plugin-renderer-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(fixtures, 'plugin-sdk'), root, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) });
  const sdkScope = path.join(root, 'plugins', 'fixture-plugin', 'node_modules', '@demoweave');
  await fs.mkdir(sdkScope, { recursive: true });
  await fs.symlink(path.join(repository, 'packages', 'sdk'), path.join(sdkScope, 'sdk'), process.platform === 'win32' ? 'junction' : 'dir');
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  const initial = ManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  await fs.rm(path.join(root, '.demoweave', 'evidence', 'artifacts'), { recursive: true, force: true });
  await fs.rm(path.join(root, 'docs-media'), { recursive: true, force: true });
  await fs.writeFile(manifestPath, `${JSON.stringify({ ...initial, evidence: [] }, null, 2)}\n`);
  const host = await loadPluginHost(root);
  await fs.writeFile(path.join(root, '.demoweave', 'project.json'), `${JSON.stringify(await host.applyDetectors(await analyzeProject(root)), null, 2)}\n`);
  assert.equal((await runFlow('service-proof', { projectRoot: root })).status, 'passed');
  const first = await renderEvidence('plugin-service-result', {
    projectRoot: root, format: 'svg', rendererId: 'plugin/fixture-service/fixture-service-card', pluginHost: await loadPluginHost(root),
  });
  assert.equal(first.evidenceId, 'plugin-service-result-fixture-service-card-svg');
  let report = await analyzeFreshness(root, { pluginFingerprints: (await loadPluginHost(root)).fingerprints() });
  assert.equal(report.evidence.find((item) => item.evidenceId === first.evidenceId)?.state, 'fresh');

  const pluginPath = path.join(root, 'plugins', 'fixture-plugin', 'index.js');
  await fs.appendFile(pluginPath, '\n// renderer implementation mutation\n');
  let changedHost = await loadPluginHost(root);
  report = await analyzeFreshness(root, { pluginFingerprints: changedHost.fingerprints() });
  assert.equal(report.evidence.find((item) => item.evidenceId === first.evidenceId)?.reasons.some((reason) => reason.code === 'plugin-changed'), true);
  assert.equal((await runFlow('service-proof', { projectRoot: root })).status, 'passed');
  changedHost = await loadPluginHost(root);
  report = await analyzeFreshness(root, { pluginFingerprints: changedHost.fingerprints() });
  assert.deepEqual(report.regeneration, [{
    kind: 'render-evidence', sourceEvidenceId: 'plugin-service-result', evidenceId: first.evidenceId!, format: 'svg',
    outputPath: 'docs-media/plugin-service-result-fixture-service-card-svg.svg', rendererId: 'plugin/fixture-service/fixture-service-card',
  }]);
  await applyRegenerationAction(root, report.regeneration[0]!);

  await fs.writeFile(path.join(root, 'marker.json'), '{"service":"fixture-service","message":"source mutation"}\n');
  report = await analyzeFreshness(root, { pluginFingerprints: changedHost.fingerprints() });
  assert.equal(report.evidence.find((item) => item.evidenceId === first.evidenceId)?.reasons.some((reason) => reason.code === 'upstream-stale'), true);
  assert.deepEqual(report.regeneration.map((action) => action.kind), ['run-flow', 'render-evidence']);
  for (const action of report.regeneration) await applyRegenerationAction(root, action);

  const stableManifest = await fs.readFile(manifestPath);
  const stableSvg = await fs.readFile(first.outputPath);
  report = await analyzeFreshness(root, { pluginFingerprints: (await loadPluginHost(root)).fingerprints() });
  assert.deepEqual(report.regeneration, []);
  assert.deepEqual(await fs.readFile(manifestPath), stableManifest);
  assert.deepEqual(await fs.readFile(first.outputPath), stableSvg);

  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), `${JSON.stringify({ schemaVersion: 1, mediaDir: 'docs-media', plugins: [] }, null, 2)}\n`);
  const unavailable = await analyzeFreshness(root, { pluginFingerprints: (await loadPluginHost(root)).fingerprints() });
  const rendererFreshness = unavailable.evidence.find((item) => item.evidenceId === first.evidenceId);
  assert.equal(rendererFreshness?.state, 'unknown');
  assert.equal(rendererFreshness?.reasons.some((reason) => reason.code === 'plugin-unavailable'), true);
  assert.deepEqual(unavailable.regeneration, []);
});
