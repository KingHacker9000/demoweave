import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeFreshness } from '../packages/core/dist/index.js';

const repository = path.resolve(import.meta.dirname, '..');
const fixture = path.join(repository, 'fixtures', 'research');
const cli = path.join(repository, 'packages', 'cli', 'dist', 'index.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-m11-research-'));
const project = path.join(tempRoot, 'research');

await fs.cp(fixture, project, { recursive: true });
try {
  const run = (args, expected = 0) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: repository,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
    return result;
  };

  const digest = async (target) => `sha256:${createHash('sha256').update(await fs.readFile(target)).digest('hex')}`;

  run(['inspect', project]);
  const profile = JSON.parse(await fs.readFile(path.join(project, '.demoweave', 'project.json'), 'utf8'));
  assert.ok(profile.surfaces.some((surface) => surface.id === 'research-research-workflow' && surface.type === 'research'));
  assert.ok(profile.surfaces.some((surface) => surface.id === 'notebook-notebooks' && surface.type === 'notebook'));

  run(['validate', project]);
  const researchRun = run(['run', 'research-results', '--project', project]);
  assert.match(researchRun.stdout, /Driver: research/);
  assert.match(researchRun.stdout, /Final: PASSED/);
  const notebookRun = run(['run', 'notebook-results', '--project', project]);
  assert.match(notebookRun.stdout, /Surface: notebook-notebooks \(notebook\)/);
  assert.match(notebookRun.stdout, /Final: PASSED/);
  run(['validate', project]);

  const manifestPath = path.join(project, '.demoweave', 'evidence', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const byId = new Map(manifest.evidence.map((item) => [item.id, item]));
  assert.equal(byId.get('research-learning-curve')?.kind, 'plot');
  assert.equal(byId.get('research-learning-curve')?.format, 'svg');
  assert.equal(byId.get('research-results-table')?.kind, 'table');
  assert.equal(byId.get('research-results-table')?.format, 'csv');
  assert.equal(byId.get('research-metrics')?.kind, 'result');
  assert.equal(byId.get('research-metrics')?.format, 'json');
  assert.equal(byId.get('research-executed-notebook')?.format, 'ipynb');
  for (const id of ['research-learning-curve', 'research-results-table', 'research-metrics', 'research-executed-notebook']) {
    const evidence = byId.get(id);
    assert.equal(evidence?.producer?.id, 'research');
    assert.match(evidence?.artifactHash ?? '', /^sha256:[0-9a-f]{64}$/);
    assert.ok(evidence?.provenance?.flowHash);
    assert.equal(evidence?.provenance?.sources.some((source) => source.path.startsWith('outputs/')), false);
  }

  const executed = JSON.parse(await fs.readFile(path.join(project, '.demoweave', 'evidence', 'artifacts', 'research-executed-notebook.ipynb'), 'utf8'));
  const codeCell = executed.cells.find((cell) => cell.cell_type === 'code');
  assert.equal(codeCell.execution_count, 1);
  assert.deepEqual(codeCell.outputs[0].text, ['best=0.93\n']);

  const fresh = await analyzeFreshness(project);
  assert.equal(fresh.summary.stale, 0);
  assert.equal(fresh.summary.missing, 0);
  assert.equal(fresh.summary.unknown, 0);
  assert.equal(fresh.summary.fresh, 4);

  await fs.rm(path.join(project, 'outputs'), { recursive: true, force: true });
  const afterOutputCleanup = await analyzeFreshness(project);
  assert.equal(afterOutputCleanup.summary.stale, 0);
  assert.equal(afterOutputCleanup.summary.missing, 0);
  assert.equal(afterOutputCleanup.summary.unknown, 0);
  assert.equal(afterOutputCleanup.summary.fresh, 4);

  await fs.appendFile(path.join(project, 'experiments', 'run.mjs'), '\n// controlled freshness mutation\n');
  const stale = await analyzeFreshness(project);
  const staleResearch = stale.evidence.filter((item) => item.state === 'stale').map((item) => item.evidenceId).sort();
  assert.deepEqual(staleResearch, ['research-learning-curve', 'research-metrics', 'research-results-table']);
  assert.equal(stale.regeneration.length, 1);
  assert.equal(stale.regeneration[0]?.kind, 'run-flow');
  assert.equal(stale.regeneration[0]?.flowId, 'research-results');

  const repaired = run(['update', project, '--apply']);
  assert.match(repaired.stdout, /Applied 1 regeneration action/);
  const afterRepair = await analyzeFreshness(project);
  assert.equal(afterRepair.summary.stale, 0);
  assert.equal(afterRepair.summary.missing, 0);
  assert.equal(afterRepair.summary.unknown, 0);

  const tracked = [
    manifestPath,
    path.join(project, '.demoweave', 'evidence', 'artifacts', 'research-learning-curve.svg'),
    path.join(project, '.demoweave', 'evidence', 'artifacts', 'research-results-table.csv'),
    path.join(project, '.demoweave', 'evidence', 'artifacts', 'research-metrics.json'),
    path.join(project, '.demoweave', 'evidence', 'artifacts', 'research-executed-notebook.ipynb'),
  ];
  const beforeNoop = await Promise.all(tracked.map(digest));
  const noop = run(['update', project, '--apply']);
  assert.match(noop.stdout, /Applied 0 regeneration actions/);
  const afterNoop = await Promise.all(tracked.map(digest));
  assert.deepEqual(afterNoop, beforeNoop);

  console.log('M11 research/notebook smoke passed: native plot/table/result/notebook Evidence, transient-output cleanup safety, selective stale repair, and zero-action no-churn.');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
