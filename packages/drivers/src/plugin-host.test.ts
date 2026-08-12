import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  analyzeFreshness,
  analyzeProject,
  FlowSchema,
  ManifestSchema,
  ProjectProfileSchema,
} from '@demoweave/core';
import { runFlow } from './executor.js';
import { loadPluginHost, PluginHostError } from './plugin-host.js';

function hash(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function project(context: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-plugin-host-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
  return root;
}

async function configure(root: string, plugins: unknown): Promise<void> {
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), `${JSON.stringify({ schemaVersion: 1, mediaDir: 'media', plugins }, null, 2)}\n`);
}

async function moduleFile(root: string, name: string, source: string): Promise<string> {
  const relative = `./${name}.js`;
  await fs.writeFile(path.join(root, `${name}.js`), source);
  return relative;
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof PluginHostError && error.code === code);
}

async function driverFixture(
  context: test.TestContext,
  source: string,
  options: Record<string, unknown>,
) {
  const root = await project(context);
  const plugin = await moduleFile(root, 'runtime-driver', source);
  await configure(root, [{ module: plugin, options }]);
  const flow = FlowSchema.parse({
    schemaVersion: 1,
    id: 'plugin-flow',
    surfaceId: 'service-fixture',
    steps: [
      { id: 'assert-step', type: 'assert', assertion: { kind: 'textContains', value: 'ready' } },
      { id: 'capture-step', type: 'capture', evidenceId: 'hosted-result', kind: 'result' },
    ],
  });
  const profile = ProjectProfileSchema.parse({
    schemaVersion: 1,
    name: 'plugin-runtime',
    root: '.',
    analyzedAt: new Date(0).toISOString(),
    packageManagers: [], workspaces: [], components: [], languages: [], frameworks: [],
    surfaces: [{ id: 'service-fixture', type: 'service', root: '.' }],
    commands: { install: [], build: [], test: [], run: [] },
    existingDocs: [],
  });
  await fs.mkdir(path.join(root, '.demoweave', 'flows'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence', 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, '.demoweave', 'flows', 'plugin-flow.json'), `${JSON.stringify(flow, null, 2)}\n`);
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [{ id: flow.id, path: '.demoweave/flows/plugin-flow.json', surfaceId: flow.surfaceId }],
    evidence: [],
  }, null, 2)}\n`);
  const driverContext = { projectRoot: root, surface: profile.surfaces[0]!, flow };
  const drivers = await (await loadPluginHost(root)).createDrivers(driverContext);
  assert.equal(drivers.length, 1);
  return { root, flow, driver: drivers[0]!, driverContext };
}

test('loader rejects traversal, absolute paths, and symlink escapes', async (context) => {
  const root = await project(context);
  await configure(root, [{ module: '../outside.js', options: {} }]);
  await expectCode(() => loadPluginHost(root), 'PLUGIN_PATH_ESCAPE');

  await configure(root, [{ module: path.join(root, 'plugin.js'), options: {} }]);
  await expectCode(() => loadPluginHost(root), 'PLUGIN_ABSOLUTE_PATH');

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-plugin-outside-'));
  context.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'index.js'), 'export default {id:"outside",apiVersion:1,register(){}};\n');
  await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await configure(root, [{ module: './linked/index.js', options: {} }]);
  await expectCode(() => loadPluginHost(root), 'PLUGIN_SYMLINK_ESCAPE');
});

test('package specifiers resolve from the target project dependency context', async (context) => {
  const root = await project(context);
  const packageRoot = path.join(root, 'node_modules', 'fixture-plugin');
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'package.json'), '{"name":"fixture-plugin","type":"module","exports":"./index.js"}\n');
  await fs.writeFile(path.join(packageRoot, 'index.js'), 'export default {id:"package-plugin",apiVersion:1,version:"1.0.0",register(){}};\n');
  await configure(root, [{ module: 'fixture-plugin', options: {} }]);
  assert.equal((await loadPluginHost(root)).list()[0]?.id, 'package-plugin');
});

test('loader reports stable validation and registration diagnostics', async (context) => {
  const root = await project(context);
  const cases: Array<{ code: string; module: string; source?: string; options?: unknown }> = [
    { code: 'PLUGIN_MODULE_MISSING', module: './missing.js' },
    { code: 'PLUGIN_EXPORT_INVALID', module: await moduleFile(root, 'bad-export', 'export default {};\n') },
    { code: 'PLUGIN_API_UNSUPPORTED', module: await moduleFile(root, 'wrong-api', 'export default {id:"wrong",apiVersion:2,register(){}};\n') },
    { code: 'PLUGIN_REGISTRATION_FAILED', module: await moduleFile(root, 'throws', 'export default {id:"throws",apiVersion:1,register(){throw new Error("boom")}};\n') },
    { code: 'PLUGIN_OPTIONS_INVALID', module: './unused.js', options: [] },
  ];
  for (const item of cases) {
    await configure(root, [{ module: item.module, options: item.options ?? {} }]);
    await expectCode(() => loadPluginHost(root), item.code);
  }
});

test('duplicate plugin and contribution ids fail instead of shadowing', async (context) => {
  const root = await project(context);
  const first = await moduleFile(root, 'first', 'export default {id:"same",apiVersion:1,register(){}};\n');
  const second = await moduleFile(root, 'second', 'export default {id:"same",apiVersion:1,register(){}};\n');
  await configure(root, [{ module: first, options: {} }, { module: second, options: {} }]);
  await expectCode(() => loadPluginHost(root), 'PLUGIN_ID_DUPLICATE');

  const detector = 'register(r){r.registerDetector({id:"same-contribution",detect(){return {}}})}';
  const a = await moduleFile(root, 'detector-a', `export default {id:"a",apiVersion:1,${detector}};\n`);
  const b = await moduleFile(root, 'detector-b', `export default {id:"b",apiVersion:1,${detector}};\n`);
  await configure(root, [{ module: a, options: {} }, { module: b, options: {} }]);
  await expectCode(() => loadPluginHost(root), 'PLUGIN_CONTRIBUTION_DUPLICATE');

  const duplicateDrivers = await moduleFile(root, 'duplicate-drivers', `export default {id:"drivers",apiVersion:1,register(r){
    const driver={id:"duplicate-driver",surfaceTypes:["service"],stepTypes:["capture"],create(){return {supports(){return true},async prepare(){},async execute(s){return {stepId:s.id,status:"passed"}},async close(){}}}};
    r.registerDriver(driver);r.registerDriver(driver);
  }};\n`);
  await configure(root, [{ module: duplicateDrivers, options: {} }]);
  await expectCode(() => loadPluginHost(root), 'PLUGIN_CONTRIBUTION_DUPLICATE');
});

test('plain JavaScript detectors receive a detached recursively frozen profile', async (context) => {
  const root = await project(context);
  const plugin = await moduleFile(root, 'readonly-detector', `export default {id:"readonly-detector",apiVersion:1,register(r){
    r.registerDetector({id:"mutation-attempt",detect({project}){
      let rejected=false;
      try { project.surfaces.push({id:"injected",type:"service",root:"../../escape"}); } catch { rejected=true; }
      if (!rejected) throw new Error("mutable detector context");
      return {surfaces:[{id:project.surfaces[0].id,type:"service",root:"."}]};
    }});
  }};\n`);
  await configure(root, [{ module: plugin, options: {} }]);
  const profile = ProjectProfileSchema.parse({
    schemaVersion: 1,
    name: 'readonly-profile',
    root: '.',
    analyzedAt: new Date(0).toISOString(),
    packageManagers: [], workspaces: [], components: [], languages: [], frameworks: [],
    surfaces: [{ id: 'built-in-service', type: 'service', root: '.' }],
    commands: { install: [], build: [], test: [], run: [] },
    existingDocs: [],
  });
  const before = JSON.stringify(profile);
  await expectCode(() => loadPluginHost(root).then((host) => host.applyDetectors(profile)), 'PLUGIN_SURFACE_DUPLICATE');
  assert.equal(JSON.stringify(profile), before);
  assert.equal(Object.isFrozen(profile), false);
  assert.deepEqual(profile.surfaces, [{ id: 'built-in-service', type: 'service', root: '.' }]);
});

test('Plugin Evidence writes are bound to the exact capture step id, Evidence id, and kind', async (context) => {
  const source = `export default {id:"evidence-binding",apiVersion:1,register(r){
    r.registerDriver({id:"evidence-driver",surfaceTypes:["service"],stepTypes:["capture"],create({options,evidence}){return {
      supports(){return true},async prepare(){},async execute(step){
        const written=await evidence.writeArtifact({
          evidenceId:options.evidenceId,stepId:options.stepId,kind:options.kind,
          format:"json",mimeType:"application/json",data:"{}\\n"
        });
        return {stepId:step.id,status:"passed",evidence:[written]};
      },async close(){}
    }}});
  }};\n`;
  const cases = [
    { name: 'unknown step', options: { stepId: 'unknown', evidenceId: 'hosted-result', kind: 'result' }, code: 'PLUGIN_EVIDENCE_STEP_INVALID' },
    { name: 'non-capture step', options: { stepId: 'assert-step', evidenceId: 'hosted-result', kind: 'result' }, code: 'PLUGIN_EVIDENCE_STEP_INVALID' },
    { name: 'mismatched Evidence id', options: { stepId: 'capture-step', evidenceId: 'other-result', kind: 'result' }, code: 'PLUGIN_EVIDENCE_ID_MISMATCH' },
    { name: 'mismatched kind', options: { stepId: 'capture-step', evidenceId: 'hosted-result', kind: 'text' }, code: 'PLUGIN_EVIDENCE_KIND_MISMATCH' },
  ];
  for (const item of cases) {
    await context.test(item.name, async (nested) => {
      const fixture = await driverFixture(nested, source, item.options);
      const result = await fixture.driver.execute(fixture.flow.steps[1]!, fixture.driverContext);
      assert.equal(result.status, 'failed');
      assert.equal(result.error?.code, item.code);
    });
  }
  await context.test('valid capture', async (nested) => {
    const fixture = await driverFixture(nested, source, { stepId: 'capture-step', evidenceId: 'hosted-result', kind: 'result' });
    const result = await fixture.driver.execute(fixture.flow.steps[1]!, fixture.driverContext);
    assert.equal(result.status, 'passed');
    assert.equal(result.evidence?.[0]?.id, 'hosted-result');
    assert.equal(await fs.readFile(path.join(fixture.root, '.demoweave', 'evidence', 'artifacts', 'hosted-result.json'), 'utf8'), '{}\n');
    const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(fixture.root, '.demoweave', 'evidence', 'manifest.json'), 'utf8')));
    assert.equal(manifest.evidence[0]?.provenance.stepId, 'capture-step');
  });
});

test('plain JavaScript driver results and hosted Evidence are validated at runtime', async (context) => {
  const source = (stepTypes: string[]) => `export default {id:"runtime-results",apiVersion:1,register(r){
    r.registerDriver({id:"runtime-driver",surfaceTypes:["service"],stepTypes:${JSON.stringify(stepTypes)},create({options,evidence}){return {
      supports(){return true},async prepare(){},async execute(step){
        if(options.mode==="wrong-step") return {stepId:"wrong",status:"passed"};
        if(options.mode==="invalid-status") return {stepId:step.id,status:"okay"};
        if(options.mode==="fabricated") return {stepId:step.id,status:"passed",evidence:[{id:"fabricated"}]};
        if(options.mode==="hosted") {
          const written=await evidence.writeArtifact({evidenceId:"hosted-result",stepId:step.id,kind:"result",format:"json",mimeType:"application/json",data:"{}\\n"});
          return {stepId:step.id,status:"passed",evidence:[written]};
        }
        return {stepId:step.id,status:"passed",stdout:"ordinary"};
      },async close(){}
    }}});
  }};\n`;
  const malformed = [
    { name: 'wrong stepId', mode: 'wrong-step', code: 'PLUGIN_DRIVER_RESULT_INVALID' },
    { name: 'invalid status', mode: 'invalid-status', code: 'PLUGIN_DRIVER_RESULT_INVALID' },
    { name: 'fabricated Evidence', mode: 'fabricated', code: 'PLUGIN_EVIDENCE_UNHOSTED' },
  ];
  for (const item of malformed) {
    await context.test(item.name, async (nested) => {
      const fixture = await driverFixture(nested, source(['capture']), { mode: item.mode });
      const result = await fixture.driver.execute(fixture.flow.steps[1]!, fixture.driverContext);
      assert.equal(result.status, 'failed');
      assert.equal(result.error?.code, item.code);
      assert.deepEqual(result.evidence, undefined);
    });
  }
  await context.test('unsupported advertised action', async (nested) => {
    const fixture = await driverFixture(nested, source(['capture']), { mode: 'ordinary' });
    const result = await fixture.driver.execute(fixture.flow.steps[0]!, fixture.driverContext);
    assert.equal(result.error?.code, 'PLUGIN_DRIVER_UNSUPPORTED_ACTION');
  });
  await context.test('valid host-written Evidence', async (nested) => {
    const fixture = await driverFixture(nested, source(['capture']), { mode: 'hosted' });
    const result = await fixture.driver.execute(fixture.flow.steps[1]!, fixture.driverContext);
    assert.equal(result.status, 'passed');
    assert.equal(result.evidence?.[0]?.id, 'hosted-result');
    assert.equal(result.evidence?.[0]?.producer?.id, 'plugin/runtime-results/runtime-driver');
  });
  await context.test('valid ordinary non-Evidence result', async (nested) => {
    const fixture = await driverFixture(nested, source(['assert']), { mode: 'ordinary' });
    const result = await fixture.driver.execute(fixture.flow.steps[0]!, fixture.driverContext);
    assert.deepEqual(result, { stepId: 'assert-step', status: 'passed', stdout: 'ordinary' });
  });
});

test('a plugin driver cannot silently override a built-in driver', async (context) => {
  const root = await project(context);
  const plugin = await moduleFile(root, 'web-driver-plugin', `export default {id:"web-plugin",apiVersion:1,register(r){
    r.registerDriver({id:"web-driver",surfaceTypes:["web"],stepTypes:["navigate"],create(){return {
      supports(){return true},async prepare(){},async execute(s){return {stepId:s.id,status:"passed"}},async close(){}
    }}})
  }};\n`);
  await configure(root, [{ module: plugin, options: {} }]);
  const metadata = path.join(root, '.demoweave');
  const flow = { schemaVersion: 1, id: 'web-flow', surfaceId: 'web-surface', steps: [{ id: 'go', type: 'navigate', destination: 'https://example.invalid' }] };
  await fs.mkdir(path.join(metadata, 'flows'), { recursive: true });
  await fs.mkdir(path.join(metadata, 'evidence'), { recursive: true });
  await fs.writeFile(path.join(metadata, 'flows', 'web-flow.json'), `${JSON.stringify(flow)}\n`);
  await fs.writeFile(path.join(metadata, 'project.json'), `${JSON.stringify({
    schemaVersion: 1,
    name: 'ambiguity',
    root: '.',
    analyzedAt: new Date(0).toISOString(),
    packageManagers: [], workspaces: [], components: [], languages: [], frameworks: [],
    surfaces: [{ id: 'web-surface', type: 'web', root: '.' }],
    commands: { install: [], build: [], test: [], run: [] }, existingDocs: [],
  })}\n`);
  await fs.writeFile(path.join(metadata, 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1, projectProfileVersion: 1,
    flows: [{ id: 'web-flow', path: '.demoweave/flows/web-flow.json', surfaceId: 'web-surface' }], evidence: [],
  })}\n`);
  const result = await runFlow('web-flow', { projectRoot: root });
  assert.equal(result.error?.code, 'DRIVER_AMBIGUOUS');
  assert.match(result.error?.message ?? '', /web, plugin\/web-plugin\/web-driver/);
});

test('external-style fixture proves detector, Evidence, fingerprints, repair, and no churn', async (context) => {
  const repository = path.resolve(import.meta.dirname, '..', '..', '..');
  const fixturesRoot = path.join(repository, 'fixtures');
  const root = await fs.mkdtemp(path.join(fixturesRoot, '.plugin-sdk-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(fixturesRoot, 'plugin-sdk'), root, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) });
  const fixtureScope = path.join(root, 'plugins', 'fixture-plugin', 'node_modules', '@demoweave');
  await fs.mkdir(fixtureScope, { recursive: true });
  await fs.symlink(
    path.join(repository, 'packages', 'sdk'),
    path.join(fixtureScope, 'sdk'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await fs.rm(path.join(root, '.demoweave', 'project.json'), { force: true });
  await fs.rm(path.join(root, '.demoweave', 'evidence', 'artifacts'), { recursive: true, force: true });
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  await fs.writeFile(manifestPath, `${JSON.stringify({ ...manifest, evidence: [] }, null, 2)}\n`);

  let host = await loadPluginHost(root);
  const profile = await host.applyDetectors(await analyzeProject(root));
  assert.deepEqual(profile.surfaces.filter((surface) => surface.id === 'service-fixture-service'), [{
    id: 'service-fixture-service', type: 'service', root: '.', framework: 'Fixture Service', label: 'fixture-service',
  }]);
  await fs.writeFile(path.join(root, '.demoweave', 'project.json'), `${JSON.stringify(profile, null, 2)}\n`);

  const first = await runFlow('service-proof', { projectRoot: root });
  assert.equal(first.status, 'passed');
  const evidence = first.evidence[0];
  assert.equal(evidence?.producer?.id, 'plugin/fixture-service/fixture-service-driver');
  assert.match(evidence?.producer?.pluginFingerprint ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence?.artifactHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence?.provenance.flowHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence?.provenance.sources[0]?.hash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(evidence).includes(root), false);

  const fresh = await analyzeFreshness(root, { pluginFingerprints: host.fingerprints() });
  assert.equal(fresh.evidence[0]?.state, 'fresh');

  const pluginPath = path.join(root, 'plugins', 'fixture-plugin', 'index.js');
  await fs.appendFile(pluginPath, '\n// implementation mutation\n');
  host = await loadPluginHost(root);
  const pluginStale = await analyzeFreshness(root, { pluginFingerprints: host.fingerprints() });
  assert.equal(pluginStale.evidence[0]?.reasons[0]?.code, 'plugin-changed');
  assert.deepEqual(pluginStale.regeneration, [{ kind: 'run-flow', flowId: 'service-proof', evidenceIds: ['plugin-service-result'] }]);
  assert.equal((await runFlow('service-proof', { projectRoot: root })).status, 'passed');

  await fs.writeFile(path.join(root, 'marker.json'), '{"service":"fixture-service","message":"source mutation"}\n');
  const sourceStale = await analyzeFreshness(root, { pluginFingerprints: host.fingerprints() });
  assert.equal(sourceStale.evidence[0]?.reasons.some((reason) => reason.code === 'source-changed'), true);
  assert.equal(sourceStale.regeneration.length, 1);
  assert.equal((await runFlow('service-proof', { projectRoot: root })).status, 'passed');
  const repairedManifest = await fs.readFile(manifestPath);
  const repairedArtifact = await fs.readFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'plugin-service-result.json'));
  const second = await analyzeFreshness(root, { pluginFingerprints: host.fingerprints() });
  assert.equal(second.regeneration.length, 0);
  assert.equal(hash(await fs.readFile(manifestPath)), hash(repairedManifest));
  assert.equal(hash(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'artifacts', 'plugin-service-result.json'))), hash(repairedArtifact));

  const flowPath = path.join(root, '.demoweave', 'flows', 'service-proof.json');
  const safeFlowBytes = await fs.readFile(flowPath);
  const unsafeFlow = JSON.parse(safeFlowBytes.toString('utf8')) as { steps: Array<{ type: string; evidenceId?: string }> };
  const capture = unsafeFlow.steps.find((step) => step.type === 'capture');
  assert.ok(capture);
  capture.evidenceId = '../escape';
  await fs.writeFile(flowPath, `${JSON.stringify(unsafeFlow, null, 2)}\n`);
  const unsafe = await runFlow('service-proof', { projectRoot: root });
  assert.equal(unsafe.steps.find((step) => step.status === 'failed')?.error?.code, 'PLUGIN_EVIDENCE_ID_INVALID');
  await fs.writeFile(flowPath, safeFlowBytes);

  await configure(root, []);
  const unavailable = await analyzeFreshness(root, { pluginFingerprints: (await loadPluginHost(root)).fingerprints() });
  assert.equal(unavailable.evidence[0]?.state, 'unknown');
  assert.equal(unavailable.evidence[0]?.reasons.some((reason) => reason.code === 'plugin-unavailable'), true);
  assert.deepEqual(unavailable.regeneration, []);
  const unresolved = await runFlow('service-proof', { projectRoot: root });
  assert.equal(unresolved.error?.code, 'DRIVER_NOT_FOUND');
});
