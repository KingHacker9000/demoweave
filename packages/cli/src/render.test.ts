import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repository = path.resolve(process.cwd(), '../..');
const cli = path.join(process.cwd(), 'dist', 'index.js');

async function fixture(context: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-render-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'evidence', 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), JSON.stringify({ schemaVersion: 1, mediaDir: 'docs-media' }));
  await fs.copyFile(
    path.join(repository, '.demoweave', 'evidence', 'artifacts', 'inspect-project-terminal.terminal.json'),
    path.join(root, '.demoweave', 'evidence', 'artifacts', 'inspect-project-terminal.terminal.json'),
  );
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [{
      schemaVersion: 1,
      id: 'inspect-project-terminal',
      kind: 'terminal',
      status: 'available',
      format: 'json',
      path: '.demoweave/evidence/artifacts/inspect-project-terminal.terminal.json',
      provenance: { sources: [] },
    }],
  }, null, 2)}\n`);
  return root;
}

test('demoweave render creates PNG derived Evidence and reports media details', async (context) => {
  const root = await fixture(context);
  const result = spawnSync(process.execPath, [cli, 'render', 'inspect-project-terminal', '--format', 'png', '--project', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Rendered: inspect-project-terminal-png/);
  assert.match(result.stdout, /Derived from: inspect-project-terminal/);
  assert.match(result.stdout, /Dimensions: \d+x\d+/);
  assert.match(result.stdout, /Output:/);
  await fs.access(path.join(root, 'docs-media', 'inspect-project-terminal.png'));
});

test('demoweave render returns a structured error and non-zero exit code', async (context) => {
  const root = await fixture(context);
  const result = spawnSync(process.execPath, [cli, 'render', 'missing-evidence', '--format', 'png', '--project', root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EVIDENCE_NOT_FOUND:/);
});
