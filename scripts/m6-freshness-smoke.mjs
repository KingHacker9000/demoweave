import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const cli = path.join(root, 'packages', 'cli', 'dist', 'index.js');
const touched = [
  '.demoweave/project.json',
  '.demoweave/evidence/manifest.json',
  '.demoweave/evidence/artifacts/inspect-project-terminal.terminal.json',
  'docs-media/inspect-project-terminal.png',
  'docs-media/inspect-project-terminal.gif',
];

async function snapshot(paths) {
  const values = new Map();
  for (const relative of paths) {
    try {
      values.set(relative, await fs.readFile(path.join(root, relative)));
    } catch (error) {
      if (error?.code === 'ENOENT') values.set(relative, null);
      else throw error;
    }
  }
  return values;
}

async function restore(values) {
  for (const [relative, bytes] of values) {
    const target = path.join(root, relative);
    if (bytes === null) {
      await fs.rm(target, { force: true });
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
  }
}

function digest(bytes) {
  return bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
}

function digestSnapshot(values) {
  return Object.fromEntries([...values.entries()].map(([relative, bytes]) => [relative, digest(bytes)]));
}

function runJson(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): demoweave ${args.join(' ')}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Expected JSON from demoweave ${args.join(' ')}, received:\n${result.stdout}\n${error}`);
  }
}

const original = await snapshot(touched);
try {
  const status = runJson(['status', '.', '--json']);
  const terminal = status.evidence.find((item) => item.evidenceId === 'inspect-project-terminal');
  const gif = status.evidence.find((item) => item.evidenceId === 'inspect-project-terminal-gif');
  const png = status.evidence.find((item) => item.evidenceId === 'inspect-project-terminal-png');

  assert.equal(terminal?.state, 'stale', 'self terminal Evidence should be stale before M6 dogfood refresh');
  assert.equal(gif?.state, 'stale', 'derived GIF should inherit staleness');
  assert.equal(png?.state, 'stale', 'derived PNG should inherit staleness');
  assert.ok(status.documents.some((item) => item.path === 'README.md' && item.evidenceIds.includes('inspect-project-terminal-gif')));
  assert.deepEqual(status.regeneration.map((action) => action.kind), ['run-flow', 'render-evidence', 'render-evidence']);
  assert.equal(status.regeneration.filter((action) => action.kind === 'run-flow').length, 1);

  const first = runJson(['update', '.', '--apply', '--json']);
  assert.equal(first.applied, true);
  assert.equal(first.actions.length, 3);
  assert.deepEqual(first.after.summary, {
    fresh: first.after.evidence.length,
    stale: 0,
    missing: 0,
    unknown: 0,
    impactedDocuments: 0,
    actions: 0,
  });

  const afterFirst = await snapshot(touched);
  const afterFirstDigests = digestSnapshot(afterFirst);

  const second = runJson(['update', '.', '--apply', '--json']);
  assert.equal(second.applied, true);
  assert.equal(second.actions.length, 0, 'second update must perform zero regeneration actions');
  assert.deepEqual(second.after.summary, first.after.summary);

  const afterSecond = await snapshot(touched);
  assert.deepEqual(digestSnapshot(afterSecond), afterFirstDigests, 'no-change update must not churn tracked artifacts or manifest bytes');

  console.log('M6 dogfood passed: stale chain explained, minimal refresh applied, second update produced zero actions and zero byte churn.');
} finally {
  await restore(original);
}
