import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getRendererCapabilities } from '@demoweave/renderer';

const repository = path.resolve(process.cwd(), '../..');
const cli = path.join(process.cwd(), 'dist', 'index.js');

async function fixture(context: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-compose-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'timelines'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.copyFile(path.join(repository, 'docs-media', 'inspect-project-terminal.gif'), path.join(root, 'media', 'terminal.gif'));
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), JSON.stringify({ schemaVersion: 1, mediaDir: 'docs-media' }));
  await fs.writeFile(path.join(root, '.demoweave', 'timelines', 'proof.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'proof',
    canvas: { width: 320, height: 180, fps: 12, background: '#0b0d14' },
    scenes: [{
      id: 'proof', durationMs: 500,
      layout: { type: 'single', padding: 12 },
      panes: [{ id: 'terminal', source: { kind: 'evidence', evidenceId: 'terminal-gif' }, fit: 'contain' }],
    }],
  }));
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [{
      schemaVersion: 1,
      id: 'terminal-gif',
      kind: 'recording',
      status: 'available',
      format: 'gif',
      path: 'media/terminal.gif',
      provenance: { sources: [] },
    }],
  }));
  return root;
}

test('demoweave compose reports structured source errors', async (context) => {
  const root = await fixture(context);
  const result = spawnSync(process.execPath, [cli, 'compose', 'missing', '--format', 'mp4', '--project', root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TIMELINE_NOT_FOUND:/);
});

test('demoweave compose creates MP4 derived Evidence and reports deterministic media details', async (context) => {
  if (!(await getRendererCapabilities()).mp4) {
    context.skip('FFmpeg is not available on PATH');
    return;
  }
  const root = await fixture(context);
  const result = spawnSync(process.execPath, [cli, 'compose', 'proof', '--format', 'mp4', '--project', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Composed: proof-mp4/);
  assert.match(result.stdout, /Derived from: terminal-gif/);
  assert.match(result.stdout, /Dimensions: 320x180/);
  assert.match(result.stdout, /Frame rate: 12 fps/);
  await fs.access(path.join(root, 'docs-media', 'proof.mp4'));
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8'));
  assert.match(manifest.evidence.find((item: any) => item.id === 'proof-mp4').artifactHash, /^sha256:/);
});
