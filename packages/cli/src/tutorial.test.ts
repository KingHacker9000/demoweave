import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repository = path.resolve(process.cwd(), '../..');
const cli = path.join(process.cwd(), 'dist', 'index.js');

function run(args: string[], cwd = repository) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', windowsHide: true });
}

async function fixture(context: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-tutorial-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.demoweave', 'tutorials'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.copyFile(path.join(repository, 'docs-media', 'terminal-web-proof.mp4'), path.join(root, 'media', 'proof.mp4'));
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), JSON.stringify({ schemaVersion: 1, mediaDir: 'docs-media' }));
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [{
      schemaVersion: 1,
      id: 'proof-video',
      kind: 'recording',
      status: 'available',
      format: 'mp4',
      path: 'media/proof.mp4',
      provenance: { sources: [] },
    }],
  }));
  await fs.writeFile(path.join(root, '.demoweave', 'tutorials', 'proof.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'proof',
    video: { evidenceId: 'proof-video' },
    metadata: {
      title: 'DemoWeave proof',
      description: 'A short deterministic tutorial package.',
      language: 'en',
    },
    thumbnail: {
      atMs: 2500,
      width: 640,
      height: 360,
      fit: 'cover',
      background: '#0b0d14',
      title: 'DemoWeave',
    },
    captions: [{ id: 'proof', startMs: 0, endMs: 4900, text: 'Runtime evidence drives this package.' }],
    chapters: [{ startMs: 0, title: 'Proof' }],
  }));
  return root;
}

test('tutorial build reports a structured missing-plan error', async (context) => {
  const root = await fixture(context);
  const result = run(['tutorial', 'build', 'missing', '--project', root], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TUTORIAL_NOT_FOUND:/);
});

test('init creates the TutorialPlan directory', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-cli-init-tutorial-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = run(['init', root]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Tutorials:/);
  assert.equal((await fs.stat(path.join(root, '.demoweave', 'tutorials'))).isDirectory(), true);
});

test('tutorial build creates the complete package when ffmpeg/ffprobe are available', async (context) => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  const ffprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (ffmpeg.status !== 0 || ffprobe.status !== 0) {
    context.skip('ffmpeg/ffprobe are not available on PATH');
    return;
  }
  const root = await fixture(context);
  const result = run(['tutorial', 'build', 'proof', '--project', root], root);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Tutorial: proof/);
  assert.match(result.stdout, /Source Evidence: proof-video/);
  assert.match(result.stdout, /Video: 1920x720, 5\.00s/);
  for (const name of [
    'proof.mp4',
    'proof-thumbnail.png',
    'proof.srt',
    'proof.vtt',
    'proof-chapters.txt',
    'proof-description.txt',
    'proof-youtube.json',
  ]) await fs.access(path.join(root, 'docs-media', 'tutorials', 'proof', name));
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8'));
  assert.equal(manifest.evidence.filter((item: any) => item.producer?.id === 'tutorial').length, 7);
});
