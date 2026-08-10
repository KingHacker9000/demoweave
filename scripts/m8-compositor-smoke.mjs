import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repository = path.resolve(import.meta.dirname, '..');
const cli = path.join(repository, 'packages', 'cli', 'dist', 'index.js');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-m8-smoke-'));

try {
  await fs.mkdir(path.join(root, '.demoweave', 'timelines'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.copyFile(path.join(repository, 'docs-media', 'inspect-project-terminal.gif'), path.join(root, 'media', 'terminal.gif'));
  await fs.copyFile(path.join(repository, 'fixtures', 'web', '.demoweave', 'evidence', 'artifacts', 'create-project-result.png'), path.join(root, 'media', 'browser.png'));
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), JSON.stringify({ schemaVersion: 1, mediaDir: 'output' }));
  await fs.writeFile(path.join(root, '.demoweave', 'timelines', 'smoke.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'smoke',
    canvas: { width: 320, height: 180, fps: 12, background: '#0b0d14' },
    scenes: [{
      id: 'proof', durationMs: 500,
      layout: { type: 'split', direction: 'horizontal', gap: 8, padding: 8 },
      panes: [
        { id: 'terminal', source: { kind: 'evidence', evidenceId: 'terminal-gif' }, fit: 'contain' },
        { id: 'browser', source: { kind: 'file', path: 'media/browser.png' }, fit: 'cover' },
      ],
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

  const composed = spawnSync(process.execPath, [cli, 'compose', 'smoke', '--format', 'mp4', '--project', root], { encoding: 'utf8', shell: false });
  assert.equal(composed.status, 0, composed.stderr);
  assert.match(composed.stdout, /Dimensions: 320x180/);
  assert.match(composed.stdout, /Frame rate: 12 fps/);
  const output = path.join(root, 'output', 'smoke.mp4');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,avg_frame_rate:format=duration', '-of', 'json', output], { encoding: 'utf8', shell: false });
  assert.equal(probe.status, 0, probe.stderr);
  const details = JSON.parse(probe.stdout);
  assert.deepEqual(details.streams[0], { width: 320, height: 180, avg_frame_rate: '12/1' });
  assert.ok(Number(details.format.duration) >= 0.49 && Number(details.format.duration) <= 0.6);
  console.log('M8 compositor smoke passed: animated Evidence + static PNG -> 320x180 MP4 at 12 fps.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
